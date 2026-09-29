import {
  Inject,
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { calls, systemSettings, contacts, operationLogs } from '@server/database/schema';
import { eq, desc, count, and, inArray, sql, gte, lte } from 'drizzle-orm';
import { buildContactNameMaps, resolveContactName } from '@server/common/contact-name';
import {
  normalizePhone,
  normalizeSyncDateTime,
  normalizeCallDirection,
  normalizeDuration,
  truncateText,
} from '@server/common/utils/sync-normalize';
import type { Call, CallListResponse, CallSyncSetting } from '@shared/api.interface';
import { UserContext } from '@server/common/context/user-context';

type CallRow = typeof calls.$inferSelect;
type CallInsert = typeof calls.$inferInsert;

const CALL_SYNC_KEY = 'call_sync_enabled';
const CALL_DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
/** 批量接口单次上限（配合网关 1MB 限制） */
const BATCH_LIMIT = 200;
/** 列表分页单页上限（超出静默钳制，响应中回显实际生效值） */
const MAX_PAGE_SIZE = 200;

@Injectable()
export class CallsService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /** 通话记录同步开关（按用户隔离，key 形如 call_sync_enabled:<userId>） */
  async getSyncSetting(): Promise<CallSyncSetting> {
    const key = this.userSyncKey();
    const [row] = await this.db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, key))
      .limit(1);
    // 默认关闭：无任何配置行时即为 false（隐私数据默认不采集）
    return { callSyncEnabled: row?.value === 'true' };
  }

  async setSyncSetting(enabled: boolean): Promise<CallSyncSetting> {
    const key = this.userSyncKey();
    const value = enabled ? 'true' : 'false';
    await this.db
      .insert(systemSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedAt: new Date() },
      });
    return { callSyncEnabled: enabled };
  }

  private userSyncKey(): string {
    let userId: string | undefined;
    try {
      userId = UserContext.getUserId();
    } catch {
      userId = undefined;
    }
    return userId ? `${CALL_SYNC_KEY}:${userId}` : CALL_SYNC_KEY;
  }

  /** 开关关闭时拒绝通话记录读写 */
  private async assertSyncEnabled(): Promise<void> {
    const setting = await this.getSyncSetting();
    if (!setting.callSyncEnabled) {
      throw new ForbiddenException('通话记录同步未开启，请先在设置中开启后重试');
    }
  }

  async findAll(query: {
    page?: number;
    pageSize?: number;
    contactId?: string;
    phone?: string;
    keyword?: string;
    /** YYYY-MM-DD 起止（含当天） */
    dateFrom?: string;
    dateTo?: string;
    /** in=呼入 out=呼出 missed=未接 */
    direction?: string;
  }): Promise<CallListResponse> {
    await this.assertSyncEnabled();
    const userId = UserContext.getUserId();

    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize =
      query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, MAX_PAGE_SIZE) : 20;
    const offset = (page - 1) * pageSize;

    const conditions = [eq(calls.userId, userId)];
    if (query.contactId) conditions.push(eq(calls.contactId, query.contactId));
    if (query.phone) conditions.push(eq(calls.phone, query.phone));
    if (query.direction) conditions.push(eq(calls.direction, query.direction));
    if (query.dateFrom) conditions.push(gte(calls.callDate, query.dateFrom));
    // 字典序比较：补当天末尾，避免「至某日」漏掉当天记录
    if (query.dateTo) conditions.push(lte(calls.callDate, `${query.dateTo} 23:59:59`));
    if (query.keyword?.trim()) {
      // 号码模糊匹配；或姓名/备注名命中的联系人 —— 既包括已关联的，也包括号码相同的
      const kw = `%${query.keyword.trim()}%`;
      const matched = await this.db
        .select({ id: contacts.id, phone: contacts.phone, secondPhone: contacts.secondPhone })
        .from(contacts)
        .where(and(
          eq(contacts.userId, userId),
          sql`((${contacts.name}) ILIKE ${kw} OR COALESCE(${contacts.nickname}, '') ILIKE ${kw})`,
        ));
      const idList = matched.map(c => c.id);
      const phoneList = [...new Set(
        matched.flatMap(c => [c.phone, c.secondPhone]).filter((v): v is string => !!v),
      )];

      const kwParts = [sql`${calls.phone} ILIKE ${kw}`];
      if (idList.length > 0) kwParts.push(inArray(calls.contactId, idList));
      if (phoneList.length > 0) kwParts.push(inArray(calls.phone, phoneList));
      conditions.push(sql`(${sql.join(kwParts, sql` OR `)})`);
    }
    const whereClause = and(...conditions);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(calls)
      .where(whereClause);

    const rows = await this.db
      .select()
      .from(calls)
      .where(whereClause)
      .orderBy(desc(calls.callDate), desc(calls.createdAt))
      .limit(pageSize)
      .offset(offset);

    // 批量补齐联系人姓名：contact_id 优先，缺失时按号码回退匹配
    const nameMaps = await buildContactNameMaps(
      this.db,
      userId,
      rows.map((r: CallRow) => r.contactId ?? ''),
      rows.map((r: CallRow) => r.phone),
    );

    return {
      items: rows.map((row: CallRow) => ({
        ...this.mapCall(row),
        contactName: resolveContactName(nameMaps, row.contactId, row.phone),
      })),
      total,
      page,
      pageSize,
    };
  }

  async create(dto: {
    contactId?: string;
    phone: string;
    direction: string;
    duration?: number;
    callDate: string;
    note?: string;
  }): Promise<Call> {
    await this.assertSyncEnabled();
    const userId = UserContext.getUserId();

    if (!dto.phone || !dto.phone.trim()) {
      throw new BadRequestException('phone 不能为空');
    }
    const direction = String(dto.direction ?? '').trim();
    if (!['in', 'out', 'missed'].includes(direction)) {
      throw new BadRequestException('direction 只允许 in / out / missed');
    }
    if (!dto.callDate || !CALL_DATE_RE.test(dto.callDate)) {
      throw new BadRequestException('callDate 格式必须为 YYYY-MM-DD HH:mm');
    }
    const duration = Number(dto.duration ?? 0);
    if (!Number.isInteger(duration) || duration < 0 || duration > 86400) {
      throw new BadRequestException('duration 必须为 0~86400 的整数（秒）');
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
      .insert(calls)
      .values({
        userId,
        contactId: dto.contactId ?? null,
        phone: dto.phone.trim(),
        direction,
        duration,
        callDate: dto.callDate,
        note: dto.note ?? null,
      })
      .returning();

    return this.mapCall(row);
  }

  /** 批量上报通话记录（App 同步用）：单条失败不影响其它；同号码+同时刻+同方向+同时长自动跳过，App 重试安全 */
  async batchCreate(dto: {
    items: Array<{
      contactId?: string;
      phone: string;
      direction: string;
      duration?: number;
      callDate: string;
      note?: string;
    }>;
  }): Promise<{ items: Call[]; errors?: Array<{ index: number; message: string }>; created: number; skipped: number }> {
    await this.assertSyncEnabled();

    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException('items 不能为空');
    }
    if (dto.items.length > BATCH_LIMIT) {
      throw new BadRequestException(`单次批量最多 ${BATCH_LIMIT} 条`);
    }
    const userId = UserContext.getUserId();

    const valid: Array<{ index: number; row: CallInsert }> = [];
    const errors: Array<{ index: number; message: string }> = [];
    // 1) 内存逐条校验：坏数据记入 errors，不阻塞整批。
    //    时间/方向宽容归一化（兼容「带秒」「ISO」「时间戳」「missed/missed_call/未接」等 App 写法），
    //    duration 允许「120s」「2:00」这类字符串并做钳制，避免整批被判无效。
    for (let i = 0; i < dto.items.length; i++) {
      const it = dto.items[i];
      const phone = normalizePhone(it?.phone);
      if (!phone) { errors.push({ index: i, message: 'phone 不能为空' }); continue; }
      const direction = normalizeCallDirection(it?.direction);
      if (!direction) {
        errors.push({ index: i, message: `direction 只允许 in / out / missed（收到：${JSON.stringify(it?.direction ?? null)}）` });
        continue;
      }
      const callDate = normalizeSyncDateTime(it?.callDate);
      if (!callDate) {
        errors.push({ index: i, message: `callDate 无法识别（收到：${JSON.stringify(it?.callDate ?? null)}），支持 YYYY-MM-DD HH:mm[:ss] / ISO8601 / 毫秒时间戳` });
        continue;
      }
      const duration = normalizeDuration(it?.duration);
      if (duration === null) { errors.push({ index: i, message: 'duration 必须为 0~86400 的整数（秒）' }); continue; }
      valid.push({
        index: i,
        row: {
          userId,
          contactId: it.contactId ?? null,
          phone,
          direction,
          duration,
          callDate,
          note: truncateText(it?.note, 2000) || null,
        },
      });
    }

    // 2) 幂等去重：库中已存在（号码+时刻+方向+时长一致）或本批内重复的一律跳过。
    //    通话没有内容体，用「同号码同分钟同方向同时长」判定同一通电话，足够可靠。
    const dedupeKey = (r: CallInsert) => `${r.phone}|${r.callDate}|${r.direction}|${r.duration ?? 0}`;
    const seen = new Set<string>();
    const skippedIdx = new Set<number>();
    if (valid.length > 0) {
      const phones = [...new Set(valid.map(v => v.row.phone as string))];
      const existing = await this.db
        .select({ phone: calls.phone, callDate: calls.callDate, direction: calls.direction, duration: calls.duration })
        .from(calls)
        .where(and(eq(calls.userId, userId), inArray(calls.phone, phones)));
      for (const e of existing) seen.add(`${e.phone}|${e.callDate}|${e.direction}|${e.duration}`);
      for (const v of valid) {
        const k = dedupeKey(v.row);
        if (seen.has(k)) { skippedIdx.add(v.index); continue; }
        seen.add(k);
      }
    }
    const toInsert = valid.filter(v => !skippedIdx.has(v.index));

    // 3) 一次多行插入
    let insertedRows: CallRow[] = [];
    if (toInsert.length > 0) {
      insertedRows = await this.db.insert(calls).values(toInsert.map(v => v.row)).returning();
    }
    const items = insertedRows.map(row => this.mapCall(row));

    return { items, errors: errors.length ? errors : undefined, created: items.length, skipped: skippedIdx.size };
  }

  /** 删除单条通话记录（管理操作，不受同步开关限制） */
  async remove(id: string): Promise<void> {
    const userId = UserContext.getUserId();
    const result = await this.db
      .delete(calls)
      .where(and(eq(calls.id, id), eq(calls.userId, userId)))
      .returning({ id: calls.id });
    if (result.length === 0) {
      throw new NotFoundException('通话记录不存在');
    }
    // 删除留痕（审计）
    try {
      await this.db.insert(operationLogs).values({
        userId,
        action: 'call_delete',
        channel: 'api',
        summary: { deleted: [{ id: result[0].id }] },
      });
    } catch {
      // 审计失败不影响主流程
    }
  }

  /** 批量删除通话记录（管理清理用） */
  /** 批量删除通话记录：ids 按 id / phone 该号码全部 / all 清空全部，三者互斥 */
  async removeMany(opts: { ids?: string[]; phone?: string; all?: boolean }): Promise<{ deleted: number }> {
    const userId = UserContext.getUserId();
    const { ids, phone, all } = opts ?? {};

    const modes = [Array.isArray(ids) && ids.length > 0, !!phone, all === true].filter(Boolean).length;
    if (modes !== 1) {
      throw new BadRequestException('ids / phone / all 必须且只能提供一项');
    }

    let whereClause;
    if (all === true) {
      whereClause = eq(calls.userId, userId);
    } else if (phone) {
      whereClause = and(eq(calls.phone, phone), eq(calls.userId, userId));
    } else {
      const idList = ids as string[];
      if (idList.length > BATCH_LIMIT) {
        throw new BadRequestException(`单次批量最多 ${BATCH_LIMIT} 条`);
      }
      whereClause = and(inArray(calls.id, idList), eq(calls.userId, userId));
    }

    const result = await this.db
      .delete(calls)
      .where(whereClause)
      .returning({ id: calls.id });

    try {
      await this.db.insert(operationLogs).values({
        userId,
        action: 'call_delete',
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

  private mapCall(row: CallRow): Call {
    return {
      id: row.id,
      contactId: row.contactId ?? undefined,
      phone: row.phone,
      direction: row.direction as Call['direction'],
      duration: row.duration,
      callDate: row.callDate,
      note: row.note ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
