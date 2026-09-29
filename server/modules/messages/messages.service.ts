import { Inject, Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { messages, systemSettings, contacts, operationLogs } from '@server/database/schema';
import { eq, desc, count, and, inArray, sql, gte, lte } from 'drizzle-orm';
import { buildContactNameMaps, resolveContactName } from '@server/common/contact-name';
import {
  normalizePhone,
  normalizeSyncDateTime,
  normalizeMessageDirection,
  truncateText,
} from '@server/common/utils/sync-normalize';
import * as crypto from 'crypto';
import type {
  Message,
  CreateMessageRequest,
  MessageListResponse,
  Conversation,
  ConversationListResponse,
  SmsSyncSetting,
  BatchCreateMessagesRequest,
  BatchCreateResult,
} from '@shared/api.interface';
import { UserContext } from '@server/common/context/user-context';

type MessageRow = typeof messages.$inferSelect;
type MessageInsert = typeof messages.$inferInsert;

const SMS_SYNC_KEY = 'sms_sync_enabled';
const MESSAGE_DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
/** 批量接口单次上限（配合网关 1MB 限制，过大请求体会在网关层被直接 500） */
const BATCH_LIMIT = 200;
/** 列表分页单页上限（超出静默钳制，响应中回显实际生效值） */
const MAX_PAGE_SIZE = 200;

@Injectable()
export class MessagesService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /** 读取短信同步开关状态（按用户隔离：每个用户拥有独立开关，key 形如 sms_sync_enabled:<userId>） */
  async getSyncSetting(): Promise<SmsSyncSetting> {
    const key = this.userSyncKey();
    const [row] = await this.db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, key))
      .limit(1);
    return { smsSyncEnabled: row?.value === 'true' };
  }

  /** 设置短信同步开关（按用户隔离；upsert，避免并发/首次写入丢行） */
  async setSyncSetting(enabled: boolean): Promise<SmsSyncSetting> {
    const key = this.userSyncKey();
    const value = enabled ? 'true' : 'false';
    await this.db
      .insert(systemSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedAt: new Date() },
      });
    return { smsSyncEnabled: enabled };
  }

  /** 构造当前用户的隔离 key；未登录（理论上不会发生）退化为全局 key */
  private userSyncKey(): string {
    let userId: string | undefined;
    try {
      userId = UserContext.getUserId();
    } catch {
      userId = undefined;
    }
    return userId ? `${SMS_SYNC_KEY}:${userId}` : SMS_SYNC_KEY;
  }

  /** 开关关闭时拒绝短信读写 */
  private async assertSyncEnabled(): Promise<void> {
    const setting = await this.getSyncSetting();
    if (!setting.smsSyncEnabled) {
      throw new ForbiddenException('短信同步未开启，请在「API 接入」页面开启后重试');
    }
  }

  async findAll(query: {
    page?: number;
    pageSize?: number;
    contactId?: string;
    phone?: string;
    /** 关键词：同时匹配短信内容 / 号码 / 联系人姓名备注名 */
    keyword?: string;
    /** 时间范围（messageDate 为 'YYYY-MM-DD HH:mm' 字符串，字典序即时序） */
    dateFrom?: string;
    dateTo?: string;
    /** 只看呼入 / 呼出 */
    direction?: string;
  }): Promise<MessageListResponse> {
    await this.assertSyncEnabled();
    const userId = UserContext.getUserId();

    const page = query.page && query.page > 0 ? query.page : 1;
    // pageSize 越界（如 999999）不做静默容忍：钳制到上限，响应中回显实际生效值
    const pageSize =
      query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, MAX_PAGE_SIZE) : 20;
    const offset = (page - 1) * pageSize;

    const conditions = [eq(messages.userId, userId)];
    if (query.contactId) conditions.push(eq(messages.contactId, query.contactId));
    if (query.phone) conditions.push(eq(messages.phone, query.phone));
    if (query.direction === 'in' || query.direction === 'out') {
      conditions.push(eq(messages.direction, query.direction));
    }
    if (query.dateFrom) conditions.push(gte(messages.messageDate, query.dateFrom));
    // 字典序比较：补当天末尾，避免「至某日」漏掉当天记录
    if (query.dateTo) conditions.push(lte(messages.messageDate, `${query.dateTo} 23:59:59`));
    if (query.keyword?.trim()) {
      const kw = `%${query.keyword.trim()}%`;
      // 内容模糊匹配，或号码匹配，或关联联系人姓名/备注名匹配（含按号码回退关联）
      conditions.push(
        sql`(${messages.body} ILIKE ${kw}
             OR ${messages.phone} ILIKE ${kw}
             OR EXISTS (
               SELECT 1 FROM contacts c
               WHERE c.user_id = ${userId}
                 AND (c.id = ${messages.contactId} OR c.phone = ${messages.phone} OR COALESCE(c.second_phone, '') = ${messages.phone})
                 AND (c.name ILIKE ${kw} OR COALESCE(c.nickname, '') ILIKE ${kw})
             ))`,
      );
    }
    const whereClause = and(...conditions);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(messages)
      .where(whereClause);

    const rows = await this.db
      .select()
      .from(messages)
      .where(whereClause)
      .orderBy(desc(messages.messageDate), desc(messages.createdAt))
      .limit(pageSize)
      .offset(offset);

    // 批量补齐联系人姓名：contact_id 优先，缺失时按号码回退匹配
    const nameMaps = await buildContactNameMaps(
      this.db,
      userId,
      rows.map((r: MessageRow) => r.contactId ?? ''),
      rows.map((r: MessageRow) => r.phone),
    );

    return {
      items: rows.map((row: MessageRow) => ({
        ...this.mapMessage(row),
        contactName: resolveContactName(nameMaps, row.contactId, row.phone),
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * 短信会话列表：按号码聚合（聊天式浏览），返回每个号码的最后一条与总条数。
   * 开关关闭时同样 403，与列表接口语义一致。
   */
  async findConversations(query: {
    page?: number;
    pageSize?: number;
    keyword?: string;
  }): Promise<ConversationListResponse> {
    await this.assertSyncEnabled();
    const userId = UserContext.getUserId();

    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize =
      query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, MAX_PAGE_SIZE) : 20;
    const offset = (page - 1) * pageSize;
    const keyword = query.keyword?.trim();

    const kwLike = '%' + keyword + '%';
    // 号码 / 短信内容 / 「已关联 / 号码相同」的联系人姓名匹配
    const keywordClause = keyword
      ? sql`AND (m.phone ILIKE ${kwLike}
             OR m.body ILIKE ${kwLike}
             OR EXISTS (
             SELECT 1 FROM contacts c
             WHERE c.user_id = ${userId}
               AND (c.id = m.contact_id OR c.phone = m.phone OR COALESCE(c.second_phone, '') = m.phone)
               AND (c.name ILIKE ${kwLike} OR COALESCE(c.nickname, '') ILIKE ${kwLike})
           ))`
      : sql``;

    const countRows = await this.db.execute<{ total: number }>(sql`
      SELECT COUNT(DISTINCT m.phone)::int AS total
      FROM messages m
      WHERE m.user_id = ${userId} ${keywordClause}
    `);
    const total = Number(countRows[0]?.total ?? 0);

    const rows = await this.db.execute<{
      phone: string;
      message_count: number;
      last_body: string;
      last_direction: string;
      last_date: string;
      contact_id: string | null;
    }>(sql`
      SELECT m.phone,
             COUNT(*)::int AS message_count,
             (array_agg(m.body ORDER BY m.message_date DESC, m._created_at DESC))[1] AS last_body,
             (array_agg(m.direction ORDER BY m.message_date DESC, m._created_at DESC))[1] AS last_direction,
             (array_agg(m.message_date ORDER BY m.message_date DESC, m._created_at DESC))[1] AS last_date,
             (array_agg(m.contact_id ORDER BY m.message_date DESC, m._created_at DESC))[1] AS contact_id
      FROM messages m
      WHERE m.user_id = ${userId} ${keywordClause}
      GROUP BY m.phone
      ORDER BY MAX(m.message_date) DESC, MAX(m._created_at) DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    const nameMaps = await buildContactNameMaps(
      this.db,
      userId,
      rows.map(r => r.contact_id ?? ''),
      rows.map(r => r.phone),
    );

    const items: Conversation[] = rows.map(r => ({
      phone: r.phone,
      contactId: r.contact_id ?? undefined,
      contactName: resolveContactName(nameMaps, r.contact_id, r.phone),
      messageCount: Number(r.message_count),
      lastBody: r.last_body ?? '',
      lastDirection: (r.last_direction === 'out' ? 'out' : 'in') as Message['direction'],
      lastMessageDate: r.last_date ?? '',
    }));

    return { items, total, page, pageSize };
  }

  async create(dto: CreateMessageRequest): Promise<Message> {
    await this.assertSyncEnabled();
    const userId = UserContext.getUserId();

    if (!dto.phone || !dto.phone.trim()) {
      throw new BadRequestException('phone 不能为空');
    }
    if (!dto.body || !dto.body.trim()) {
      throw new BadRequestException('body 不能为空');
    }
    if (dto.direction !== 'in' && dto.direction !== 'out') {
      throw new BadRequestException('direction 只允许 in 或 out');
    }
    if (!dto.messageDate || !MESSAGE_DATE_RE.test(dto.messageDate)) {
      throw new BadRequestException('messageDate 格式必须为 YYYY-MM-DD HH:mm');
    }

    // 提供了 contactId 时校验联系人存在且属于当前用户
    if (dto.contactId) {
      const [contact] = await this.db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.id, dto.contactId), eq(contacts.userId, userId)))
        .limit(1);
      if (!contact) {
        throw new NotFoundException('关联的联系人不存在');
      }
    }

    const [row] = await this.db
      .insert(messages)
      .values({
        userId,
        contactId: dto.contactId ?? null,
        phone: dto.phone.trim(),
        body: dto.body,
        direction: dto.direction,
        messageDate: dto.messageDate,
      })
      .returning();

    return this.mapMessage(row);
  }

  /** 批量上报短信（App 同步用）：单条失败不影响其它；同号码+同时刻+同内容自动跳过，App 重试安全 */
  async batchCreate(dto: BatchCreateMessagesRequest): Promise<BatchCreateResult<Message>> {
    // 开关关闭时整体拒绝（与单条上报语义一致返回 403），而不是 201 + 逐条 errors
    await this.assertSyncEnabled();

    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException('items 不能为空');
    }
    if (dto.items.length > BATCH_LIMIT) {
      throw new BadRequestException(`单次批量最多 ${BATCH_LIMIT} 条`);
    }
    const userId = UserContext.getUserId();

    const valid: Array<{ index: number; row: MessageInsert }> = [];
    const errors: Array<{ index: number; message: string }> = [];
    // 1) 内存逐条校验：坏数据记入 errors，不阻塞整批。
    //    时间/方向做宽容归一化（App 端常见「带秒」「ISO」「时间戳」「incoming」等写法），
    //    能救回的尽量救，避免整批被判无效（历史上表现为「同步 N 条失败」却查不到错误）。
    for (let i = 0; i < dto.items.length; i++) {
      const it = dto.items[i];
      const phone = normalizePhone(it?.phone);
      const body = truncateText(it?.body);
      if (!phone) { errors.push({ index: i, message: 'phone 不能为空' }); continue; }
      if (!body.trim()) { errors.push({ index: i, message: 'body 不能为空' }); continue; }
      const direction = normalizeMessageDirection(it?.direction);
      if (!direction) {
        errors.push({ index: i, message: `direction 只允许 in 或 out（收到：${JSON.stringify(it?.direction ?? null)}）` });
        continue;
      }
      const messageDate = normalizeSyncDateTime(it?.messageDate);
      if (!messageDate) {
        errors.push({ index: i, message: `messageDate 无法识别（收到：${JSON.stringify(it?.messageDate ?? null)}），支持 YYYY-MM-DD HH:mm[:ss] / ISO8601 / 毫秒时间戳` });
        continue;
      }
      valid.push({
        index: i,
        row: { userId, contactId: it.contactId ?? null, phone, body, direction, messageDate },
      });
    }

    // 2) 幂等去重：库中已存在（号码+时刻+内容一致）或本批内重复的一律跳过。
    //    没有这层，App「失败重试」会把已成功的批次再插一遍，造成整倍重复数据。
    const dedupeKey = (phone: string, date: string, body: string) =>
      `${phone}|${date}|${crypto.createHash('md5').update(body).digest('hex')}`;
    const seen = new Set<string>();
    const skippedIdx = new Set<number>();
    if (valid.length > 0) {
      const phones = [...new Set(valid.map(v => v.row.phone as string))];
      const existing = await this.db
        .select({ phone: messages.phone, messageDate: messages.messageDate, hash: sql<string>`md5(${messages.body})` })
        .from(messages)
        .where(and(eq(messages.userId, userId), inArray(messages.phone, phones)));
      for (const e of existing) seen.add(`${e.phone}|${e.messageDate}|${e.hash}`);
      for (const v of valid) {
        const k = dedupeKey(v.row.phone as string, v.row.messageDate as string, v.row.body as string);
        if (seen.has(k)) { skippedIdx.add(v.index); continue; }
        seen.add(k);
      }
    }
    const toInsert = valid.filter(v => !skippedIdx.has(v.index));

    // 3) 一次多行插入（500 条一个语句，替代逐条 INSERT）
    let insertedRows: MessageRow[] = [];
    if (toInsert.length > 0) {
      insertedRows = await this.db.insert(messages).values(toInsert.map(v => v.row)).returning();
    }
    const items = insertedRows.map(row => this.mapMessage(row));

    // 4) 记录操作流水（短信数据可追溯）
    try {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const batchName =
        dto.batchName?.trim() ||
        `App短信同步 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      await this.db.insert(operationLogs).values({
        userId,
        action: 'batch_sync',
        channel: 'app_sync',
        deviceInfo: dto.deviceInfo ?? undefined,
        summary: { total: dto.items.length, created: items.length, skipped: skippedIdx.size, failed: errors.length, batchName },
      });
    } catch {
      // 流水记录失败不影响主流程
    }

    return { items, errors: errors.length ? errors : undefined, created: items.length, skipped: skippedIdx.size };
  }

  /**
   * 删除单条短信。
   * 注意：删除属于数据管理操作，不受「短信同步开关」限制——
   * 避免开关关闭时残留数据无法清理的死锁。
   */
  async remove(id: string): Promise<void> {
    const userId = UserContext.getUserId();
    const result = await this.db
      .delete(messages)
      .where(and(eq(messages.id, id), eq(messages.userId, userId)))
      .returning({ id: messages.id });
    if (result.length === 0) {
      throw new NotFoundException('短信不存在');
    }
    // 删除留痕（审计）
    try {
      await this.db.insert(operationLogs).values({
        userId,
        action: 'message_delete',
        channel: 'api',
        summary: { deleted: [{ id: result[0].id }] },
      });
    } catch {
      // 审计失败不影响主流程
    }
  }

  /**
   * 批量删除短信（管理清理用），返回实际删除条数。
   * 不存在的 id 静默跳过；同样不受「短信同步开关」限制。
   */
  /**
   * 批量删除短信，三选一：
   * - ids：按 id 删除（上限 BATCH_LIMIT）
   * - phone：删除该号码下的全部短信（删除整个会话）
   * - all：清空当前用户全部短信
   * 三者互斥，都不传返回 400。
   */
  async removeMany(opts: {
    ids?: string[];
    phone?: string;
    all?: boolean;
  }): Promise<{ deleted: number }> {
    const userId = UserContext.getUserId();
    const { ids, phone, all } = opts ?? {};

    const modes = [Array.isArray(ids) && ids.length > 0, !!phone, all === true].filter(Boolean).length;
    if (modes !== 1) {
      throw new BadRequestException('ids / phone / all 必须且只能提供一项');
    }

    let whereClause;
    if (all === true) {
      whereClause = eq(messages.userId, userId);
    } else if (phone) {
      whereClause = and(eq(messages.phone, phone), eq(messages.userId, userId));
    } else {
      const idList = ids as string[];
      if (idList.length > BATCH_LIMIT) {
        throw new BadRequestException(`单次批量最多 ${BATCH_LIMIT} 条`);
      }
      whereClause = and(inArray(messages.id, idList), eq(messages.userId, userId));
    }

    const result = await this.db
      .delete(messages)
      .where(whereClause)
      .returning({ id: messages.id });

    // 批量删除留痕（审计）：只记数量与范围，不落原文
    try {
      await this.db.insert(operationLogs).values({
        userId,
        action: 'message_delete',
        channel: 'api',
        summary: {
          deletedCount: result.length,
          scope: all === true ? 'all' : phone ? `phone:${phone}` : 'ids',
        },
      });
    } catch {
      // 审计失败不影响主流程
    }

    return { deleted: result.length };
  }

  private mapMessage(row: MessageRow): Message {
    return {
      id: row.id,
      contactId: row.contactId ?? undefined,
      phone: row.phone,
      body: row.body,
      direction: row.direction as Message['direction'],
      messageDate: row.messageDate,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
