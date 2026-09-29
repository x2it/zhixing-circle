import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { contacts, contactTags, tags, followups, importBatches, operationLogs, mergeLogs, messages, calls } from '@server/database/schema';
import {
  eq,
  and,
  count,
  desc,
  asc,
  or,
  ilike,
  inArray,
  ne,
  gte,
  lte,
  lt,
  isNull,
  isNotNull,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type {
  Contact,
  Tag,
  Followup,
  ContactListQuery,
  ContactListResponse,
  CreateContactRequest,
  UpdateContactRequest,
  BatchArchiveRequest,
  BatchCreateContactsRequest,
  BatchCreateResult,
  BatchByFilterRequest,
  BatchByFilterResponse,
  ContactFilter,
  PrefixStat,
  PrefixCleanRequest,
  PrefixCleanResponse,
  TagCategory,
  DuplicateGroup,
  MergeContactsRequest,
  MergeContactsResponse,
} from '@shared/api.interface';
import { UserContext } from '@server/common/context/user-context';
import { truncateText } from '@server/common/utils/sync-normalize';
import { BusinessException } from '@server/common/interfaces/exception.interface';
import { ResponseCode } from '@server/common/constants/api_response_code';

/** 批量接口单次上限（配合网关 1MB 限制，过大请求体会在网关层被直接 500） */
export const BATCH_LIMIT = 200;
/** 列表分页单页上限（超出静默钳制，响应中回显实际生效值）；「全部」模式按此封顶 */
export const MAX_PAGE_SIZE = 5000;
/** 批次自动归组时间窗：同名 App 批次在此窗口内复用，不再碎片化新建 */
const BATCH_MERGE_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);


  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async findAll(query: ContactListQuery): Promise<ContactListResponse> {
    const userId = UserContext.getUserId();
    const page = query.page && query.page > 0 ? query.page : 1;
    // pageSize 越界（如 999999）不做静默容忍：钳制到上限，响应中回显实际生效值
    const pageSize =
      query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, MAX_PAGE_SIZE) : 20;
    const offset = (page - 1) * pageSize;

    // 构建 where 条件（数据隔离：只看当前用户的数据）
    const conditions = [eq(contacts.userId, userId)];

    if (query.search) {
      const searchTerm = `%${query.search}%`;
      conditions.push(
        or(
          ilike(contacts.name, searchTerm),
          ilike(contacts.nickname, searchTerm),
          ilike(contacts.phone, searchTerm),
          ilike(contacts.secondPhone, searchTerm),
        ),
      );
    }

    if (query.tier) {
      conditions.push(eq(contacts.tier, query.tier));
    }

    if (query.archived !== 'all') {
      conditions.push(eq(contacts.archived, query.archived === true));
    }

    if (query.batchId) {
      conditions.push(eq(contacts.batchId, query.batchId));
    }

    // 按「下次跟进日期」筛选：移动端待办视图的核心能力（今天/本周/逾期/无计划）
    const todayStr = this.localDate();
    switch (query.followupStatus) {
      case 'overdue':
        conditions.push(
          isNotNull(contacts.nextFollowupDate),
          lt(contacts.nextFollowupDate, todayStr),
        );
        break;
      case 'today':
        conditions.push(eq(contacts.nextFollowupDate, todayStr));
        break;
      case 'week':
        conditions.push(
          isNotNull(contacts.nextFollowupDate),
          gte(contacts.nextFollowupDate, todayStr),
          lte(contacts.nextFollowupDate, this.localWeekEnd()),
        );
        break;
      case 'none':
        conditions.push(isNull(contacts.nextFollowupDate));
        break;
      default:
        if (query.nextFollowupAfter) {
          conditions.push(
            isNotNull(contacts.nextFollowupDate),
            gte(contacts.nextFollowupDate, query.nextFollowupAfter),
          );
        }
        if (query.nextFollowupBefore) {
          conditions.push(
            isNotNull(contacts.nextFollowupDate),
            lte(contacts.nextFollowupDate, query.nextFollowupBefore),
          );
        }
    }

    // 标签筛选：改为 SQL EXISTS 子查询，支持多标签 AND/OR，避免大标签下 IN 子句膨胀
    const tagIds = [
      ...new Set([
        ...(query.tagIds ?? []),
        ...(query.tagId ? [query.tagId] : []),
      ]),
    ];
    if (tagIds.length > 0) {
      const idList = sql.join(tagIds.map((id) => sql`${id}`), sql`, `);
      if (query.tagMode === 'all') {
        conditions.push(
          sql`EXISTS (
            SELECT 1 FROM ${contactTags} ct
            WHERE ct.contact_id = ${contacts.id} AND ct.tag_id IN (${idList})
            GROUP BY ct.contact_id
            HAVING count(DISTINCT ct.tag_id) = ${tagIds.length}
          )`,
        );
      } else {
        conditions.push(
          sql`EXISTS (
            SELECT 1 FROM ${contactTags} ct
            WHERE ct.contact_id = ${contacts.id} AND ct.tag_id IN (${idList})
          )`,
        );
      }
    }

    // 手机号有无筛选：排查 App 同步进来的无号联系人
    if (query.phoneStatus === 'with') {
      conditions.push(isNotNull(contacts.phone));
    } else if (query.phoneStatus === 'without') {
      conditions.push(isNull(contacts.phone));
    }

    const whereClause = and(...conditions);

    // 排序：扩展字段，NULL 统一沉底，追加 id 次级排序保证分页稳定
    const orderExpr = this.buildOrderBy(query.sortBy, query.sortOrder);

    // 总数
    const countResult = await this.db
      .select({ count: count() })
      .from(contacts)
      .where(whereClause);
    const total = countResult[0]?.count ?? 0;

    // 分页列表
    const rows = await this.db
      .select()
      .from(contacts)
      .where(whereClause)
      .orderBy(...orderExpr)
      .limit(pageSize)
      .offset(offset);

    if (rows.length === 0) {
      return { items: [], total, page, pageSize };
    }

    // 批量查标签
    const contactIds = rows.map((r: typeof contacts.$inferSelect) => r.id);
    const allTags = await this.getTagsForContacts(contactIds);

    const items = rows.map((row: typeof contacts.$inferSelect) =>
      this.mapToContact(row, allTags.get(row.id) ?? []),
    );

    return { items, total, page, pageSize };
  }

  /**
   * 构建联系人列表排序表达式。
   * - 扩展字段：name / nickname / phone / tier / nextFollowupDate / followupNote / tag / createdAt / updatedAt
   * - 统一 NULLS LAST：空值不随升降序翻转到列表顶部
   * - 追加 id ASC 次级排序：同键值时顺序确定，翻页不重不漏
   */
  private buildOrderBy(
    sortBy: ContactListQuery['sortBy'],
    sortOrder: ContactListQuery['sortOrder'],
  ): SQL[] {
    // 默认排序：updatedAt DESC；跟进日期默认 ASC（最早待办在前）
    const effectiveSortBy = sortBy ?? 'updatedAt';
    const effectiveSortOrder =
      sortOrder ??
      (effectiveSortBy === 'nextFollowupDate' || effectiveSortBy === 'name' ? 'asc' : 'desc');
    const dir = effectiveSortOrder === 'asc' ? sql`ASC` : sql`DESC`;
    const key = (expr: SQL | PgColumn) => sql`${expr} ${dir} NULLS LAST`;

    const primary: SQL = (() => {
      switch (effectiveSortBy) {
        case 'name':
          return key(contacts.name);
        case 'nickname':
          return key(sql`COALESCE(${contacts.nickname}, ${contacts.name})`);
        case 'phone':
          return key(contacts.phone);
        case 'tier':
          return key(
            sql`CASE ${contacts.tier}
              WHEN 'S' THEN 1 WHEN 'A' THEN 2 WHEN 'B' THEN 3
              WHEN 'C' THEN 4 WHEN 'V' THEN 5 WHEN 'D' THEN 6
              ELSE 7 END`,
          );
        case 'nextFollowupDate':
          return key(contacts.nextFollowupDate);
        case 'followupNote':
          return key(sql`COALESCE(${contacts.followupNote}, '')`);
        case 'tag':
          return key(
            sql`(SELECT min(t.name)
                FROM ${contactTags} ct
                JOIN ${tags} t ON t.id = ct.tag_id
                WHERE ct.contact_id = ${contacts.id})`,
          );
        case 'createdAt':
          return key(contacts.createdAt);
        case 'updatedAt':
        default:
          return key(contacts.updatedAt);
      }
    })();

    return [primary, sql`${contacts.id} ASC`];
  }

  async findOne(id: string): Promise<Contact & { followups: Followup[] }> {
    const userId = UserContext.getUserId();
    const [row] = await this.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
      .limit(1);

    if (!row) {
      throw new NotFoundException('联系人不存在');
    }

    const tagList = await this.getTagsForContacts([id]);
    const recentFollowups = await this.db
      .select()
      .from(followups)
      .where(eq(followups.contactId, id))
      .orderBy(desc(followups.followupDate), desc(followups.createdAt))
      .limit(10);

    const contact = this.mapToContact(row, tagList.get(id) ?? []);
    return {
      ...contact,
      followups: recentFollowups.map((f: typeof followups.$inferSelect) =>
        this.mapToFollowup(f),
      ),
    };
  }

  /**
   * 必填校验：name 与 phone 至少一项非空（空串、纯空白视为缺失）。
   * 不通过时返回 400 + 字段级错误。
   */
  private assertNameOrPhonePresent(name: string, phone: string): void {
    if (!name && !phone) {
      throw new BusinessException(
        ResponseCode.VALIDATION_ERROR,
        'name 与 phone 至少一项必填',
        HttpStatus.BAD_REQUEST,
        undefined,
        { name: ['name 与 phone 至少一项必填'], phone: ['name 与 phone 至少一项必填'] },
      );
    }
  }

  /**
   * phone 唯一性校验（同一用户内，phone 非空时）。
   * DB 层另有部分唯一索引兜底（并发下应用层查重可能竞态，由 23505 → 409 兜底）。
   */
  private async assertPhoneUnique(
    tx: PostgresJsDatabase,
    phone: string,
    excludeContactId?: string,
  ): Promise<void> {
    const userId = UserContext.getUserId();
    const conditions = [eq(contacts.userId, userId), eq(contacts.phone, phone)];
    if (excludeContactId) conditions.push(ne(contacts.id, excludeContactId));
    const [dup] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(...conditions))
      .limit(1);
    if (dup) {
      throw new BusinessException(
        ResponseCode.CONFLICT,
        `phone 已存在于其他联系人（id: ${dup.id}）`,
        HttpStatus.CONFLICT,
        undefined,
        { phone: ['phone 已存在，同一用户下手机号不可重复'] },
      );
    }
  }

  async create(dto: CreateContactRequest, batchId?: string): Promise<Contact> {
    const userId = UserContext.getUserId();
    // 入参归一化：空串/纯空白视为未提供
    const name = (dto.name ?? '').trim();
    const phone = (dto.phone ?? '').trim();
    this.assertNameOrPhonePresent(name, phone);

    return this.db.transaction(async (tx) => {
      if (phone) {
        await this.assertPhoneUnique(tx, phone);
      }
      const [row] = await tx
        .insert(contacts)
        .values({
          userId,
          // name 列 DB 层 notNull：仅提供了 phone 时用 phone 兜底，保证列表可读
          name: name || phone,
          nickname: dto.nickname,
          phone: phone || null,
          secondPhone: dto.secondPhone,
          wechat: dto.wechat,
          tier: this.normalizeTier(dto.tier),
          memo: dto.memo,
          relationshipType: dto.relationshipType,
          source: dto.source,
          email: dto.email,
          company: dto.company,
          jobTitle: dto.jobTitle,
          address: dto.address,
          birthday: dto.birthday,
          externalId: dto.externalId,
          nextFollowupDate: dto.nextFollowupDate ?? undefined,
          followupNote: dto.followupNote,
          batchId,
        })
        .returning();

      // 支持 tagIds 与 tagNames（标签名，App 端更友好）两种入参
      let tagIdsToLink = dto.tagIds ?? [];
      if (dto.tagNames && dto.tagNames.length > 0) {
        const resolved = await this.resolveTagNamesToIds(tx, dto.tagNames);
        tagIdsToLink = [...new Set([...tagIdsToLink, ...resolved])];
      }
      if (tagIdsToLink.length > 0) {
        const ownedTagIds = await this.filterOwnedTagIds(tx, tagIdsToLink);
        if (ownedTagIds.length > 0) {
          await tx
            .insert(contactTags)
            .values(ownedTagIds.map((tagId: string) => ({
              contactId: row.id,
              tagId,
            })))
            .onConflictDoNothing();
        }
      }

      const tagList = await this.getTagsForContactsTx(tx, [row.id]);
      return this.mapToContact(row, tagList.get(row.id) ?? []);
    });
  }

  /** 把标签名数组解析为标签 id（不存在则自动创建，云端权威：标签由云端统一命名） */
  private async resolveTagNamesToIds(
    tx: Parameters<Parameters<PostgresJsDatabase['transaction']>[0]>[0],
    names: string[],
  ): Promise<string[]> {
    const userId = UserContext.getUserId();
    const cleaned = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))];
    if (cleaned.length === 0) return [];

    const existing = await tx
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(and(eq(tags.userId, userId), inArray(tags.name, cleaned)));
    const byName = new Map<string, string>(existing.map((t: { id: string; name: string }) => [t.name, t.id]));

    const result: string[] = [];
    for (const name of cleaned) {
      let id = byName.get(name);
      if (!id) {
        // 自动创建 = 模板名单之外的名字（官方标签已由模板应用时入库，同名会直接复用），
        // 归入 sync 隔离类目，不污染模板定义的 identity/attribute 正式标签体系
        const [row] = await tx
          .insert(tags)
          .values({ userId, name, category: 'sync', color: '#94a3b8', sortOrder: 100 })
          .returning({ id: tags.id });
        id = row.id;
        byName.set(name, id);
      }
      result.push(id);
    }
    return result;
  }

  /** 过滤出属于当前用户的标签 id（防跨用户关联） */
  private async filterOwnedTagIds(
    tx: PostgresJsDatabase,
    tagIds: string[],
  ): Promise<string[]> {
    const userId = UserContext.getUserId();
    if (tagIds.length === 0) return [];
    const rows = await tx
      .select({ id: tags.id })
      .from(tags)
      .where(and(inArray(tags.id, tagIds), eq(tags.userId, userId)));
    return rows.map((r: { id: string }) => r.id);
  }

  /**
   * 批量创建（App 同步用）：单条失败不影响其它，逐条回传错误
   * 每次调用生成一个独立批次，写入 batchId，支持后续按批次追溯与回滚
   */
  async batchCreate(dto: BatchCreateContactsRequest): Promise<BatchCreateResult<Contact>> {
    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException('items 不能为空');
    }
    if (dto.items.length > BATCH_LIMIT) {
      throw new BadRequestException(`单次批量最多 ${BATCH_LIMIT} 条`);
    }

    const userId = UserContext.getUserId();
    const channel = dto.source === 'tma' ? 'app_sync' : 'app_sync';
    const dtoBatchName = dto.batchName?.trim();

    // 1) 批次归组：App 传了固定 batchName 时，24h 内同名批次直接复用，
    //    避免「每 100 条一个新批次」把批次列表刷成几十行没法管理。
    let batchId: string;
    let batchName: string;
    if (dtoBatchName) {
      const [existingBatch] = await this.db
        .select({ id: importBatches.id })
        .from(importBatches)
        .where(
          and(
            eq(importBatches.userId, userId),
            eq(importBatches.name, dtoBatchName),
            eq(importBatches.status, 'active'),
            eq(importBatches.channel, 'app_sync'),
            sql`${importBatches.createdAt} > now() - interval '24 hours'`,
          ),
        )
        .limit(1);
      if (existingBatch) {
        batchId = existingBatch.id;
        batchName = dtoBatchName;
      }
    }
    if (!batchId) {
      batchName = dtoBatchName || this.buildBatchName('App同步');
      const [batchRow] = await this.db
        .insert(importBatches)
        .values({
          userId,
          name: batchName,
          source: dto.source ?? 'app',
          channel,
          deviceInfo: dto.deviceInfo ?? undefined,
          status: 'active',
          contactCount: 0,
        })
        .returning({ id: importBatches.id });
      batchId = batchRow.id;
    }

    const items: Contact[] = [];
    const errors: Array<{ index: number; message: string }> = [];
    let created = 0;
    let skipped = 0;

    // 分块批量写入：每 CHUNK 条一个事务，块内用「批量查 + 多行 INSERT」替代逐条 create。
    // 原实现每条一个事务（含 phone 查重、externalId 查重、标签解析），500 条约 8.5s，
    // 大批量同步时逼近网关超时。改后同量级约 10 个事务，耗时降一个数量级。
    const CHUNK = 100;
    for (let start = 0; start < dto.items.length; start += CHUNK) {
      const chunk = dto.items.slice(start, start + CHUNK);
      let result: { out: Contact[]; errs: Array<{ index: number; message: string }>; created: number; skipped: number };
      try {
        result = await this.db.transaction(async (tx) => this.bulkInsertChunk(tx, chunk, start, userId, batchId));
      } catch (e: unknown) {
        // 整块事务失败（如 DB 唯一索引冲突）不能拖垮整批：退化为逐条重试，坏数据单独进 errors
        result = { out: [], errs: [], created: 0, skipped: 0 };
        for (let k = 0; k < chunk.length; k++) {
          try {
            const item = chunk[k];
            if (item.externalId) {
              const existing = await this.findByExternalId(item.externalId);
              if (existing) {
                result.out.push(existing);
                result.skipped += 1;
                continue;
              }
            }
            result.out.push(await this.create(item, batchId));
            result.created += 1;
          } catch (inner: unknown) {
            result.errs.push({
              index: start + k,
              message: inner instanceof Error ? inner.message : '创建失败',
            });
          }
        }
      }
      items.push(...result.out);
      errors.push(...result.errs);
      created += result.created;
      skipped += result.skipped;
    }

    // 2) 回填批次统计（复用批次时累加而非覆盖）+ 记录操作流水
    await this.db
      .update(importBatches)
      .set({
        contactCount: sql`${importBatches.contactCount} + ${created}`,
        contactCreated: sql`${importBatches.contactCreated} + ${created}`,
        contactSkipped: sql`${importBatches.contactSkipped} + ${skipped}`,
        updatedAt: new Date(),
      })
      .where(and(eq(importBatches.id, batchId), eq(importBatches.userId, userId)));

    await this.db.insert(operationLogs).values({
      userId,
      batchId,
      action: 'batch_sync',
      channel,
      deviceInfo: dto.deviceInfo ?? undefined,
      summary: { total: dto.items.length, created, skipped, failed: errors.length, batchName },
    });

    return {
      items,
      errors: errors.length ? errors : undefined,
      created,
      batchId,
      batchName,
      skipped,
    };
  }

  /**
   * 块内批量写入（在调用方事务中执行）。
   * 保持与 create() 完全一致的语义：name/phone 至少一项、phone 同用户唯一、
   * externalId 幂等、tagIds/tagNames 双通道关联标签，单条问题只进 errors。
   */
  private async bulkInsertChunk(
    tx: Parameters<Parameters<PostgresJsDatabase['transaction']>[0]>[0],
    chunk: CreateContactRequest[],
    offset: number,
    userId: string,
    batchId: string,
  ): Promise<{
    out: Contact[];
    errs: Array<{ index: number; message: string }>;
    created: number;
    skipped: number;
  }> {
    const out: Contact[] = [];
    const errs: Array<{ index: number; message: string }> = [];
    let created = 0;
    let skipped = 0;

    // a) 一次查全 externalId 命中（幂等：已存在直接返回既有对象）
    const extList = [
      ...new Set(
        chunk
          .map((i) => (i.externalId ?? '').trim())
          .filter((v): v is string => v.length > 0),
      ),
    ];
    const extHit = new Map<string, typeof contacts.$inferSelect>();
    const extIdsOfHits: string[] = [];
    if (extList.length > 0) {
      const rows = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.userId, userId), inArray(contacts.externalId, extList)));
      for (const r of rows) {
        if (!r.externalId) continue;
        extHit.set(r.externalId, r);
        extIdsOfHits.push(r.id);
      }
    }

    // b) 一次查全 phone 占用情况（含本块已占位，防块内自我冲突）
    const phoneList = [
      ...new Set(
        chunk.map((i) => (i.phone ?? '').trim()).filter((v): v is string => v.length > 0),
      ),
    ];
    const busyPhones = new Set<string>();
    if (phoneList.length > 0) {
      const rows = await tx
        .select({ phone: contacts.phone })
        .from(contacts)
        .where(and(eq(contacts.userId, userId), inArray(contacts.phone, phoneList)));
      for (const r of rows) if (r.phone) busyPhones.add(r.phone);
    }

    // c) 内存逐条校验并构造待插入行（本阶段零查询）
    type Pending = {
      index: number;
      values: typeof contacts.$inferInsert;
      tagNames: string[];
      tagIds: string[];
    };
    const pending: Pending[] = [];
    for (let k = 0; k < chunk.length; k++) {
      const globalIndex = offset + k;
      const item = chunk[k];
      const name = (item.name ?? '').trim();
      const phone = (item.phone ?? '').trim();
      const externalId = (item.externalId ?? '').trim();

      if (externalId && extHit.has(externalId)) {
        skipped += 1;
        continue;
      }
      if (!name && !phone) {
        errs.push({ index: globalIndex, message: 'name 与 phone 至少一项必填' });
        continue;
      }
      if (phone && busyPhones.has(phone)) {
        errs.push({ index: globalIndex, message: `phone 已存在于其他联系人（${phone}）` });
        continue;
      }
      if (phone) busyPhones.add(phone);
      pending.push({
        index: globalIndex,
        values: {
          userId,
          name: name || phone,
          nickname: item.nickname,
          phone: phone || null,
          secondPhone: item.secondPhone,
          wechat: item.wechat,
          tier: this.normalizeTier(item.tier),
          memo: item.memo !== undefined ? truncateText(item.memo, 2000) : undefined,
          relationshipType: item.relationshipType,
          source: item.source,
          email: item.email,
          company: item.company,
          jobTitle: item.jobTitle,
          address: item.address,
          birthday: item.birthday,
          externalId: externalId || null,
          nextFollowupDate: item.nextFollowupDate ?? undefined,
          followupNote: item.followupNote !== undefined ? truncateText(item.followupNote, 2000) : undefined,
          batchId,
        },
        tagNames: item.tagNames ?? [],
        tagIds: item.tagIds ?? [],
      });
    }

    // d) 多行 INSERT（一条语句写完本块）
    if (pending.length > 0) {
      const inserted = await tx
        .insert(contacts)
        .values(pending.map((p) => p.values))
        .returning();

      // e) 标签：本块所有 tagNames 一次性解析，关联一次性写入
      const allNames = [...new Set(pending.flatMap((p) => p.tagNames))].filter(Boolean);
      const nameToId = new Map<string, string>();
      if (allNames.length > 0) {
        const resolved = await this.resolveTagNamesToIds(tx, allNames);
        allNames.forEach((n, i) => {
          if (resolved[i]) nameToId.set(n, resolved[i]);
        });
      }
      const links: Array<{ contactId: string; tagId: string }> = [];
      for (let i = 0; i < pending.length; i++) {
        const row = inserted[i];
        if (!row) continue;
        const ids = new Set<string>(pending[i].tagIds ?? []);
        for (const n of pending[i].tagNames ?? []) {
          const id = nameToId.get(n);
          if (id) ids.add(id);
        }
        for (const tagId of ids) links.push({ contactId: row.id, tagId });
      }
      if (links.length > 0) {
        const owned = await this.filterOwnedTagIds(tx, [...new Set(links.map((l) => l.tagId))]);
        const ownedSet = new Set(owned);
        const validLinks = links.filter((l) => ownedSet.has(l.tagId));
        if (validLinks.length > 0) {
          await tx.insert(contactTags).values(validLinks).onConflictDoNothing();
        }
      }

      // f) 统一回查标签并映射输出
      const tagList = await this.getTagsForContactsTx(tx, inserted.map((r) => r.id));
      for (const row of inserted) {
        out.push(this.mapToContact(row, tagList.get(row.id) ?? []));
        created += 1;
      }
    }

    // g) externalId 命中的既有对象也要带标签返回
    if (extIdsOfHits.length > 0) {
      const tagList = await this.getTagsForContactsTx(tx, extIdsOfHits);
      for (const r of extHit.values()) {
        out.push(this.mapToContact(r, tagList.get(r.id) ?? []));
      }
    }

    return { out, errs, created, skipped };
  }

  /** 生成批次名：`App同步 2026-09-28 15:30` */
  private buildBatchName(prefix: string): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${prefix} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** 按 externalId 查找当前用户的联系人（App 幂等同步用） */
  async findByExternalId(externalId: string): Promise<Contact | null> {
    const userId = UserContext.getUserId();
    const [row] = await this.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.externalId, externalId), eq(contacts.userId, userId)))
      .limit(1);
    if (!row) return null;
    const tagList = await this.getTagsForContacts([row.id]);
    return this.mapToContact(row, tagList.get(row.id) ?? []);
  }

  async update(id: string, dto: UpdateContactRequest): Promise<Contact> {
    const userId = UserContext.getUserId();
    // 入参归一化：显式传入的空串/纯空白视为置空
    const incomingName = dto.name !== undefined ? String(dto.name).trim() : undefined;
    const incomingPhone = dto.phone !== undefined ? String(dto.phone).trim() : undefined;

    return this.db.transaction(async (tx) => {
      // 若本次更新触及 name/phone，需合并 DB 原值校验「更新后至少一项非空」
      if (incomingName !== undefined || incomingPhone !== undefined) {
        const [current] = await tx
          .select({ name: contacts.name, phone: contacts.phone })
          .from(contacts)
          .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
          .limit(1);
        if (current) {
          const nextName = incomingName ?? String(current.name ?? '').trim();
          const nextPhone = incomingPhone ?? String(current.phone ?? '').trim();
          try {
            this.assertNameOrPhonePresent(nextName, nextPhone);
          } catch {
            throw new BusinessException(
              ResponseCode.VALIDATION_ERROR,
              '更新后 name 与 phone 不能同时为空',
              HttpStatus.BAD_REQUEST,
              undefined,
              { name: ['更新后 name 与 phone 不能同时为空'], phone: ['更新后 name 与 phone 不能同时为空'] },
            );
          }
        }
      }

      const patch: Partial<typeof contacts.$inferInsert> = {};
      if (dto.name !== undefined) patch.name = incomingName;
      if (dto.nickname !== undefined) patch.nickname = dto.nickname;
      if (dto.phone !== undefined) patch.phone = incomingPhone || null;
      if (dto.secondPhone !== undefined) patch.secondPhone = dto.secondPhone;
      if (dto.wechat !== undefined) patch.wechat = dto.wechat;
      if (dto.tier !== undefined) patch.tier = this.normalizeTier(dto.tier);
      if (dto.memo !== undefined) patch.memo = dto.memo;
      if (dto.relationshipType !== undefined) patch.relationshipType = dto.relationshipType;
      if (dto.source !== undefined) patch.source = dto.source;
      if (dto.email !== undefined) patch.email = dto.email;
      if (dto.company !== undefined) patch.company = dto.company;
      if (dto.jobTitle !== undefined) patch.jobTitle = dto.jobTitle;
      if (dto.address !== undefined) patch.address = dto.address;
      if (dto.birthday !== undefined) patch.birthday = dto.birthday || undefined;
      if (dto.externalId !== undefined) patch.externalId = dto.externalId;
      if (dto.nextFollowupDate !== undefined) {
        patch.nextFollowupDate = dto.nextFollowupDate || undefined;
      }
      if (dto.followupNote !== undefined) patch.followupNote = dto.followupNote;
      if (dto.archived !== undefined) patch.archived = dto.archived;
      // 更新时自动刷新更新时间（时间戳用于多端合并时判断最新）
      patch.updatedAt = new Date();

      // phone 唯一性：同一用户下非空 phone 不可重复（排除自身）
      const nextPhoneValue = typeof patch.phone === 'string' ? patch.phone.trim() : '';
      if (nextPhoneValue) {
        await this.assertPhoneUnique(tx, nextPhoneValue, id);
      }

      // 允许只有 tagIds 更新
      if (Object.keys(patch).length > 0) {
        const [updated] = await tx
          .update(contacts)
          .set(patch)
          .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
          .returning();

        if (!updated) {
          throw new NotFoundException('联系人不存在');
        }
      } else {
        // 验证联系人是否存在
        const [existing] = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
          .limit(1);
        if (!existing) {
          throw new NotFoundException('联系人不存在');
        }
      }

      // 全量替换标签关联（仅接受属于当前用户的标签）
      if (dto.tagIds !== undefined) {
        await tx.delete(contactTags).where(eq(contactTags.contactId, id));
        if (dto.tagIds.length > 0) {
          const ownedTagIds = await this.filterOwnedTagIds(tx, dto.tagIds);
          if (ownedTagIds.length > 0) {
            await tx
              .insert(contactTags)
              .values(ownedTagIds.map((tagId: string) => ({
                contactId: id,
                tagId,
              })));
          }
        }
      }

      // 读取最新数据
      const [finalRow] = await tx
        .select()
        .from(contacts)
        .where(eq(contacts.id, id))
        .limit(1);

      const tagList = await this.getTagsForContactsTx(tx, [id]);
      return this.mapToContact(finalRow, tagList.get(id) ?? []);
    });
  }

  async remove(id: string): Promise<void> {
    const userId = UserContext.getUserId();
    const result = await this.db
      .delete(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
      .returning({ id: contacts.id, name: contacts.name });

    if (result.length === 0) {
      throw new NotFoundException('联系人不存在');
    }
    // 删除留痕（审计）：数据消失时必须可追溯
    try {
      await this.db.insert(operationLogs).values({
        userId,
        action: 'contact_delete',
        channel: 'api',
        summary: { deleted: [{ id: result[0].id, name: result[0].name }] },
      });
    } catch {
      // 审计失败不影响删除主流程
    }
  }

  /**
   * 批量删除联系人（App 端 v2.7.0 起使用：DELETE /api/contacts + { ids }）。
   *
   * 契约要点：
   * - 用户隔离：只删 userId 命中的记录，他人 id 一律不删（防越权）
   * - 幂等：重复删同一批返回 deleted=0 且仍算成功，App 重试安全
   * - 关联清理：跟进 / 标签关联 / 合并留痕与「删除批次」保持一致，不留孤儿数据
   */
  async batchDelete(ids: string[]): Promise<number> {
    const userId = UserContext.getUserId();
    return this.db.transaction(async (tx) => {
      // 先按 userId 收敛出真正可删的 id，越权 id 在此被自然过滤掉
      const owned = await tx
        .select({ id: contacts.id, name: contacts.name })
        .from(contacts)
        .where(and(inArray(contacts.id, ids), eq(contacts.userId, userId)))
        .limit(BATCH_LIMIT);

      if (owned.length === 0) return 0;
      const ownedIds = owned.map((r) => r.id);

      // 关联清理：不依赖 DB 外键，保证任何部署环境行为一致
      await tx.delete(followups).where(inArray(followups.contactId, ownedIds));
      await tx.delete(contactTags).where(inArray(contactTags.contactId, ownedIds));
      await tx.delete(mergeLogs).where(inArray(mergeLogs.keepContactId, ownedIds));

      const deleted = await tx
        .delete(contacts)
        .where(and(inArray(contacts.id, ownedIds), eq(contacts.userId, userId)))
        .returning({ id: contacts.id });

      // 审计留痕：批量操作尤其需要可追溯
      try {
        await tx.insert(operationLogs).values({
          userId,
          action: 'contact_delete_batch',
          channel: 'api',
          summary: {
            requested: ids.length,
            deleted: deleted.length,
            deletedNames: owned.slice(0, 20).map((r) => r.name),
          },
        });
      } catch {
        // 审计失败不影响删除主流程
      }

      return deleted.length;
    });
  }

  /**
   * 分层快捷修改：只改 tier，不影响其它字段（App 端列表长按改分层用）。
   * 非法值（含 App 本地的 U）按既定策略归一为 D，不返回 400，避免脏数据阻塞同步。
   */
  async updateTier(id: string, tier: string): Promise<Contact> {
    const userId = UserContext.getUserId();
    const normalized = this.normalizeTier(tier) ?? 'D';

    const result = await this.db
      .update(contacts)
      .set({ tier: normalized, updatedAt: new Date() })
      .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
      .returning();

    if (result.length === 0) {
      throw new NotFoundException('联系人不存在');
    }
    const tagList = await this.getTagsForContacts([id]);
    return this.mapToContact(result[0], tagList.get(id) ?? []);
  }

  async batchArchive(dto: BatchArchiveRequest): Promise<{ updated: number }> {
    const userId = UserContext.getUserId();
    if (!dto.contactIds || dto.contactIds.length === 0) {
      throw new BadRequestException('contactIds 不能为空');
    }

    const result = await this.db
      .update(contacts)
      .set({ archived: dto.archived, updatedAt: new Date() })
      .where(and(inArray(contacts.id, dto.contactIds), eq(contacts.userId, userId)))
      .returning({ id: contacts.id });

    return { updated: result.length };
  }

  /**
   * 按筛选条件批量操作（跨页批量的服务端实现）。
   * 归档/取消归档/打标签都作用于「筛选命中的全部联系人」，无需把几千个 id 从前端传回来。
   */
  async batchByFilter(dto: BatchByFilterRequest): Promise<BatchByFilterResponse> {
    const userId = UserContext.getUserId();
    const filter = dto.filter ?? {};
    const conditions = this.buildFilterConditions(userId, filter);
    const whereClause = and(...conditions);

    // 先算命中数（打标签也要用命中列表）
    const matchedRows = await this.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(whereClause);
    const matched = matchedRows.length;

    if (dto.action === 'archive' || dto.action === 'unarchive') {
      const result = await this.db
        .update(contacts)
        .set({ archived: dto.action === 'archive', updatedAt: new Date() })
        .where(whereClause)
        .returning({ id: contacts.id });
      await this.auditLog(userId, 'contacts_batch_by_filter', {
        action: dto.action,
        filter,
        matched,
        updated: result.length,
      });
      return { matched, updated: result.length };
    }

    // addTags
    if (!Array.isArray(dto.tagIds) || dto.tagIds.length === 0) {
      throw new BadRequestException('addTags 需要提供 tagIds');
    }
    const tagIds = dto.tagIds;
    const existingPairs = matched > 0
      ? await this.db
          .select({ contactId: contactTags.contactId, tagId: contactTags.tagId })
          .from(contactTags)
          .where(and(inArray(contactTags.contactId, matchedRows.map(r => r.id)), inArray(contactTags.tagId, tagIds)))
      : [];
    const have = new Set(existingPairs.map(e => `${e.contactId}|${e.tagId}`));
    const toInsert: Array<{ contactId: string; tagId: string }> = [];
    for (const { id } of matchedRows) {
      for (const tagId of tagIds) {
        if (!have.has(`${id}|${tagId}`)) toInsert.push({ contactId: id, tagId });
      }
    }
    let tagsAdded = 0;
    for (let i = 0; i < toInsert.length; i += 1000) {
      const chunk = toInsert.slice(i, i + 1000);
      await this.db.insert(contactTags).values(chunk).onConflictDoNothing();
      tagsAdded += chunk.length;
    }
    await this.auditLog(userId, 'contacts_batch_by_filter', {
      action: 'addTags',
      filter,
      tagIds,
      matched,
      tagsAdded,
    });
    return { matched, updated: matched, tagsAdded };
  }

  /**
   * 重复检测（Excel 式去重的前置：只识别 + 给出建议，绝不自动合并）。
   * - phone 组：归一化手机号相同 → 强判重依据
   * - name 组：仅姓名相同 → 只提示，同名未必同一人，不预设合并
   */
  async findDuplicates(): Promise<DuplicateGroup[]> {
    const userId = UserContext.getUserId();

    // 归一化：去掉非数字字符，再去掉 +86 / 86 前缀；过短的号不参与判重
    const normSql = sql`regexp_replace(regexp_replace(COALESCE(${contacts.phone}, ''), '[^0-9]', '', 'g'), '^(0086|86)', '')`;

    const phoneGroups = await this.db.execute<{ phone_key: string; cnt: number }>(sql`
      SELECT norm AS phone_key, count(*)::int AS cnt
      FROM (
        SELECT ${contacts.id}, ${normSql} AS norm
        FROM contacts
        WHERE ${contacts.userId} = ${userId}
      ) t
      WHERE length(norm) >= 7
      GROUP BY 1
      HAVING count(*) > 1
      ORDER BY cnt DESC
      LIMIT 50
    `);

    const groups: DuplicateGroup[] = [];
    const involvedIds = new Set<string>();

    for (const g of phoneGroups) {
      const rows = await this.db
        .select({
          id: contacts.id,
          name: contacts.name,
          nickname: contacts.nickname,
          phone: contacts.phone,
          tier: contacts.tier,
          createdAt: contacts.createdAt,
        })
        .from(contacts)
        .where(
          and(
            eq(contacts.userId, userId),
            sql`${normSql} = ${g.phone_key} AND length(${normSql}) >= 7`,
          ),
        );
      if (rows.length < 2) continue;
      groups.push({
        key: String(g.phone_key),
        type: 'phone',
        autoSuggest: true,
        suggestedKeepId: '',
        contacts: rows.map(r => ({
          id: r.id,
          name: r.name,
          nickname: r.nickname ?? undefined,
          phone: r.phone ?? undefined,
          tier: r.tier ?? undefined,
          tagNames: [],
          followupCount: 0,
          messageCount: 0,
          callCount: 0,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt ?? ''),
        })),
      });
      rows.forEach(r => involvedIds.add(r.id));
    }

    // 同名提示组（排除已按手机号成组的 id，避免重复展示）
    const nameGroups = await this.db.execute<{ name_key: string; cnt: number }>(sql`
      SELECT name AS name_key, count(*)::int AS cnt
      FROM contacts
      WHERE user_id = ${userId}
      GROUP BY 1
      HAVING count(*) > 1
      ORDER BY cnt DESC
      LIMIT 30
    `);
    for (const g of nameGroups) {
      const rows = await this.db
        .select({
          id: contacts.id,
          name: contacts.name,
          nickname: contacts.nickname,
          phone: contacts.phone,
          tier: contacts.tier,
          createdAt: contacts.createdAt,
        })
        .from(contacts)
        .where(and(eq(contacts.userId, userId), eq(contacts.name, String(g.name_key))));
      const fresh = rows.filter(r => !involvedIds.has(r.id));
      if (fresh.length < 2) continue;
      groups.push({
        key: `name:${String(g.name_key)}`,
        type: 'name',
        autoSuggest: false,
        suggestedKeepId: '',
        contacts: fresh.map(r => ({
          id: r.id,
          name: r.name,
          nickname: r.nickname ?? undefined,
          phone: r.phone ?? undefined,
          tier: r.tier ?? undefined,
          tagNames: [],
          followupCount: 0,
          messageCount: 0,
          callCount: 0,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt ?? ''),
        })),
      });
      fresh.forEach(r => involvedIds.add(r.id));
    }

    // 统一补全标签 / 跟进 / 短信 / 通话 数量，并计算建议保留项
    await this.enrichDuplicateStats(userId, groups);
    return groups;
  }

  /** 批量补全候选联系人的标签与关联数据量 */
  private async enrichDuplicateStats(userId: string, groups: DuplicateGroup[]): Promise<void> {
    const ids = [...new Set(groups.flatMap(g => g.contacts.map(c => c.id)))];
    if (ids.length === 0) return;

    const [tagRows, followupRows, messageRows, callRows] = await Promise.all([
      this.db
        .select({ contactId: contactTags.contactId, name: tags.name })
        .from(contactTags)
        .innerJoin(tags, eq(tags.id, contactTags.tagId))
        .where(inArray(contactTags.contactId, ids)),
      this.db
        .select({ contactId: followups.contactId, cnt: count() })
        .from(followups)
        .where(inArray(followups.contactId, ids))
        .groupBy(followups.contactId),
      this.db
        .select({ contactId: messages.contactId, cnt: count() })
        .from(messages)
        .where(inArray(messages.contactId, ids))
        .groupBy(messages.contactId),
      this.db
        .select({ contactId: calls.contactId, cnt: count() })
        .from(calls)
        .where(inArray(calls.contactId, ids))
        .groupBy(calls.contactId),
    ]);

    const tagMap = new Map<string, string[]>();
    for (const r of tagRows) {
      const list = tagMap.get(r.contactId) ?? [];
      list.push(r.name);
      tagMap.set(r.contactId, list);
    }
    const countMap = (rows: Array<{ contactId: string | null; cnt: number }>) => {
      const m = new Map<string, number>();
      for (const r of rows) if (r.contactId) m.set(r.contactId, Number(r.cnt));
      return m;
    };
    const followupMap = countMap(followupRows);
    const messageMap = countMap(messageRows);
    const callMap = countMap(callRows);

    for (const g of groups) {
      for (const c of g.contacts) {
        c.tagNames = tagMap.get(c.id) ?? [];
        c.followupCount = followupMap.get(c.id) ?? 0;
        c.messageCount = messageMap.get(c.id) ?? 0;
        c.callCount = callMap.get(c.id) ?? 0;
      }
      // 信息完整度打分：有手机 + 有分层 + 标签数 + 跟进数 + 沟通数；平手取更早创建
      const scored = g.contacts
        .map(c => ({
          c,
          score:
            (c.phone ? 2 : 0) +
            (c.tier ? 1 : 0) +
            c.tagNames.length * 2 +
            c.followupCount * 2 +
            c.messageCount +
            c.callCount,
        }))
        .sort((a, b) => b.score - a.score || a.c.createdAt.localeCompare(b.c.createdAt));
      if (scored.length > 0) g.suggestedKeepId = scored[0].c.id;
    }
  }

  /**
   * 确认式合并（Excel 去重的人工确认步骤）：
   * 迁移标签/跟进/短信/通话到保留记录 → 空字段补全 → 删除被合并记录 → 写合并日志。
   * 服务端永不自动合并，必须由用户显式提交 groups。
   */
  async mergeContacts(dto: MergeContactsRequest): Promise<MergeContactsResponse> {
    const userId = UserContext.getUserId();
    if (!Array.isArray(dto.groups) || dto.groups.length === 0) {
      throw new BadRequestException('groups 不能为空');
    }

    let mergedGroups = 0;
    let deletedContacts = 0;
    let movedTags = 0;
    let movedFollowups = 0;
    let movedMessages = 0;
    let movedCalls = 0;

    for (const group of dto.groups) {
      const mergeIds = [...new Set((group.mergeIds ?? []).filter(id => id && id !== group.keepId))];
      if (mergeIds.length === 0) continue;

      // 归属校验：保留项与被合并项必须都属于当前用户
      const rows = await this.db
        .select()
        .from(contacts)
        .where(and(eq(contacts.userId, userId), inArray(contacts.id, [group.keepId, ...mergeIds])));
      const keepRow = rows.find(r => r.id === group.keepId);
      const mergeRows = rows.filter(r => mergeIds.includes(r.id));
      if (!keepRow || mergeRows.length === 0) continue;

      // 1) 标签迁移（已存在的组合跳过）
      const existingPairs = await this.db
        .select({ contactId: contactTags.contactId, tagId: contactTags.tagId })
        .from(contactTags)
        .where(inArray(contactTags.contactId, [group.keepId, ...mergeIds]));
      const have = new Set(existingPairs.filter(e => e.contactId === group.keepId).map(e => e.tagId));
      const tagPairsToMove = existingPairs.filter(e => e.contactId !== group.keepId && !have.has(e.tagId));
      for (const p of tagPairsToMove) have.add(p.tagId);
      if (tagPairsToMove.length > 0) {
        await this.db
          .insert(contactTags)
          .values(tagPairsToMove.map(p => ({ contactId: group.keepId, tagId: p.tagId })))
          .onConflictDoNothing();
        movedTags += tagPairsToMove.length;
      }

      // 2) 关联数据迁移（跟进 / 短信 / 通话）
      for (const id of mergeIds) {
        const [f, m, c] = await Promise.all([
          this.db.update(followups).set({ contactId: group.keepId }).where(and(eq(followups.contactId, id), eq(followups.userId, userId))).returning({ id: followups.id }),
          this.db.update(messages).set({ contactId: group.keepId }).where(and(eq(messages.contactId, id), eq(messages.userId, userId))).returning({ id: messages.id }),
          this.db.update(calls).set({ contactId: group.keepId }).where(and(eq(calls.contactId, id), eq(calls.userId, userId))).returning({ id: calls.id }),
        ]);
        movedFollowups += f.length;
        movedMessages += m.length;
        movedCalls += c.length;
      }

      // 3) 字段补全：保留记录已有值优先，空字段用被合并方补齐（分层不覆盖，避免降级）
      const patch: Partial<typeof contacts.$inferInsert> = {};
      const fill = <K extends keyof typeof keepRow>(field: K) => {
        const keepVal = keepRow[field];
        if (keepVal !== null && keepVal !== undefined && keepVal !== '') return;
        for (const r of mergeRows) {
          const v = r[field];
          if (v !== null && v !== undefined && v !== '') {
            (patch as Record<string, unknown>)[field as string] = v;
            return;
          }
        }
      };
      (['nickname', 'phone', 'secondPhone', 'wechat', 'email', 'company', 'jobTitle', 'memo', 'source', 'relationshipType'] as const).forEach(f => fill(f));
      if (Object.keys(patch).length > 0) {
        await this.db
          .update(contacts)
          .set({ ...patch, updatedAt: new Date() })
          .where(and(eq(contacts.id, group.keepId), eq(contacts.userId, userId)));
      }

      // 4) 删除被合并记录（标签/跟进/短信/通话已迁移，其余外键会级联清理）
      await this.db.delete(contacts).where(and(eq(contacts.userId, userId), inArray(contacts.id, mergeIds)));
      deletedContacts += mergeRows.length;

      // 5) 合并留痕（可追溯）
      await this.db.insert(mergeLogs).values({
        userId,
        keepContactId: group.keepId,
        keepContactName: keepRow.name,
        mergedContactIds: mergeRows.map(r => r.id),
        mergedContactNames: mergeRows.map(r => r.name),
        mergedPhone: keepRow.phone ?? mergeRows.find(r => r.phone)?.phone ?? null,
        mergedFollowups: movedFollowups,
        mergedTags: tagPairsToMove.length,
        similarityType: 'phone',
      });
      mergedGroups += 1;
    }

    await this.auditLog(userId, 'contacts_merge', {
      mergedGroups,
      deletedContacts,
      movedTags,
      movedFollowups,
      movedMessages,
      movedCalls,
    });
    return { mergedGroups, deletedContacts, movedTags, movedFollowups, movedMessages, movedCalls };
  }
  private buildFilterConditions(userId: string, filter: ContactFilter) {
    const conditions = [eq(contacts.userId, userId)];
    if (filter.batchId) conditions.push(eq(contacts.batchId, filter.batchId));
    if (filter.tier) conditions.push(eq(contacts.tier, filter.tier));
    if (filter.archived !== undefined) conditions.push(eq(contacts.archived, filter.archived));
    if (filter.keyword?.trim()) {
      const kw = `%${filter.keyword.trim()}%`;
      conditions.push(
        sql`(${contacts.name} ILIKE ${kw} OR COALESCE(${contacts.nickname}, '') ILIKE ${kw} OR COALESCE(${contacts.phone}, '') ILIKE ${kw} OR COALESCE(${contacts.secondPhone}, '') ILIKE ${kw})`,
      );
    }
    return conditions;
  }

  /** 操作审计（数据治理动作必须留痕） */
  private async auditLog(userId: string, action: string, summary: Record<string, unknown>): Promise<void> {
    try {
      await this.db.insert(operationLogs).values({ userId, action, channel: 'web', summary });
    } catch {
      // 审计失败不影响主流程
    }
  }

  /**
   * 名称前缀分析：识别「yj陈铁兵 / b北京李哥 / w盛唐城李师」这类
   * 用户在手机通讯录里手工打的字母前缀，返回频次与示例。
   * 只统计「字母开头 + 后面跟中文/·」的名字，纯英文姓名不算前缀。
   */
  async analyzePrefixes(): Promise<PrefixStat[]> {
    const userId = UserContext.getUserId();
    const rows = await this.db.execute<{ prefix: string; cnt: number; examples: string[] }>(sql`
      SELECT lower(substring(name from '^([A-Za-z]{1,8})')) AS prefix,
             count(*)::int AS cnt,
             (array_agg(name ORDER BY name))[1:3] AS examples
      FROM contacts
      WHERE user_id = ${userId}
        AND name ~ '^[A-Za-z]{1,8}[一-龥·]'
      GROUP BY 1
      ORDER BY cnt DESC
      LIMIT 30
    `);
    return rows.map(r => ({
      prefix: r.prefix,
      count: Number(r.cnt),
      examples: Array.isArray(r.examples) ? r.examples : [],
    }));
  }

  /**
   * 前缀清洗：把指定字母前缀的联系人「去掉前缀」或「批量打标签」。
   * dryRun=true 时只返回预览不落库——先智能识别，人工二次确认，再批量执行。
   */
  async cleanPrefix(dto: PrefixCleanRequest): Promise<PrefixCleanResponse> {
    const userId = UserContext.getUserId();
    const prefix = (dto.prefix ?? '').trim();
    if (!/^[A-Za-z]{1,8}$/.test(prefix)) {
      throw new BadRequestException('prefix 必须是 1~8 位字母');
    }
    if (dto.mode === 'tag' && !dto.tagName?.trim()) {
      throw new BadRequestException('mode=tag 需要提供 tagName');
    }

    // 命中：字母前缀 + 后面紧跟中文/·（避免误伤纯英文姓名）
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = `^${escaped}[一-龥·]`;
    const hits = await this.db
      .select({ id: contacts.id, name: contacts.name })
      .from(contacts)
      .where(and(eq(contacts.userId, userId), sql`${contacts.name} ~* ${pattern}`))
      .limit(5000);

    const stripName = (name: string): string =>
      name
        .replace(new RegExp(`^${escaped}`, 'i'), '')
        .replace(/^[\s·]+/, '')
        .trimStart();

    if (dto.dryRun) {
      return {
        matched: hits.length,
        changed: 0,
        skipped: 0,
        preview: hits.slice(0, 20).map(h => ({
          id: h.id,
          name: h.name,
          newName: dto.mode === 'strip' ? stripName(h.name) : undefined,
        })),
      };
    }

    let changed = 0;
    let skipped = 0;

    if (dto.mode === 'strip') {
      // 逐条更新（改名无法用同一 SQL 表达去重逻辑；5000 上限内可接受）
      for (const h of hits) {
        const newName = stripName(h.name);
        if (!newName || newName === h.name) {
          skipped += 1;
          continue;
        }
        await this.db
          .update(contacts)
          .set({ name: newName, updatedAt: new Date() })
          .where(and(eq(contacts.id, h.id), eq(contacts.userId, userId)));
        changed += 1;
      }
    } else {
      const tagName = dto.tagName!.trim();
      // 标签不存在则创建（默认归「来源」分组，颜色取默认盘）
      let [tag] = await this.db
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.userId, userId), eq(tags.name, tagName)))
        .limit(1);
      if (!tag) {
        const [created] = await this.db
          .insert(tags)
          .values({ userId, name: tagName, category: '来源' as TagCategory, color: '#0ea5e9' })
          .returning({ id: tags.id });
        tag = created;
      }
      const existing = hits.length
        ? await this.db
            .select({ contactId: contactTags.contactId })
            .from(contactTags)
            .where(and(inArray(contactTags.contactId, hits.map(h => h.id)), eq(contactTags.tagId, tag.id)))
        : [];
      const have = new Set(existing.map(e => e.contactId));
      const toInsert = hits.filter(h => !have.has(h.id)).map(h => ({ contactId: h.id, tagId: tag.id }));
      for (let i = 0; i < toInsert.length; i += 1000) {
        await this.db.insert(contactTags).values(toInsert.slice(i, i + 1000)).onConflictDoNothing();
      }
      changed = toInsert.length;
      skipped = hits.length - toInsert.length;
    }

    await this.auditLog(userId, 'contacts_prefix_clean', {
      prefix,
      mode: dto.mode,
      tagName: dto.tagName,
      matched: hits.length,
      changed,
      skipped,
    });
    return {
      matched: hits.length,
      changed,
      skipped,
      preview: [],
    };
  }

  // --- 辅助方法 ---

  /**
   * 层级归一化：线上分层体系为 S/A/B/C/D/V 六层。
   * App 端存在本地的 U（未拨打/未分类）等非法值统一归为 D（线索客户），
   * 避免 U 落库后在分层看板与统计中"隐形"。
   */
  private normalizeTier(tier: string | undefined | null): string | undefined {
    if (tier === undefined || tier === null) return undefined;
    const v = String(tier).trim().toUpperCase();
    return ['S', 'A', 'B', 'C', 'D', 'V'].includes(v) ? v : 'D';
  }

  /** 本地日期 YYYY-MM-DD（与仪表盘口径一致，next_followup_date 无时区语义） */
  private localDate(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** 本周日 YYYY-MM-DD（周一为一周起点） */
  private localWeekEnd(): string {
    const d = new Date();
    const diffToMonday = d.getDay() === 0 ? 6 : d.getDay() - 1;
    const sunday = new Date(d);
    sunday.setDate(d.getDate() - diffToMonday + 6);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${sunday.getFullYear()}-${pad(sunday.getMonth() + 1)}-${pad(sunday.getDate())}`;
  }

  private async getTagsForContacts(contactIds: string[]): Promise<Map<string, Tag[]>> {
    const relations = await this.db
      .select({
        contactId: contactTags.contactId,
        tagId: tags.id,
        tagName: tags.name,
        tagCategory: tags.category,
        tagColor: tags.color,
        tagSortOrder: tags.sortOrder,
      })
      .from(contactTags)
      .innerJoin(tags, eq(contactTags.tagId, tags.id))
      .where(inArray(contactTags.contactId, contactIds))
      .orderBy(tags.sortOrder, tags.name);

    const map = new Map<string, Tag[]>();
    for (const rel of relations) {
      const tag: Tag = {
        id: rel.tagId,
        name: rel.tagName,
        category: rel.tagCategory as Tag['category'],
        color: rel.tagColor ?? '#64748b',
        sortOrder: rel.tagSortOrder ?? 0,
      };
      const existing = map.get(rel.contactId) ?? [];
      existing.push(tag);
      map.set(rel.contactId, existing);
    }
    return map;
  }

  private async getTagsForContactsTx(
    tx: PostgresJsDatabase,
    contactIds: string[],
  ): Promise<Map<string, Tag[]>> {
    const relations = await tx
      .select({
        contactId: contactTags.contactId,
        tagId: tags.id,
        tagName: tags.name,
        tagCategory: tags.category,
        tagColor: tags.color,
        tagSortOrder: tags.sortOrder,
      })
      .from(contactTags)
      .innerJoin(tags, eq(contactTags.tagId, tags.id))
      .where(inArray(contactTags.contactId, contactIds))
      .orderBy(tags.sortOrder, tags.name);

    const map = new Map<string, Tag[]>();
    for (const rel of relations) {
      const tag: Tag = {
        id: rel.tagId,
        name: rel.tagName,
        category: rel.tagCategory as Tag['category'],
        color: rel.tagColor ?? '#64748b',
        sortOrder: rel.tagSortOrder ?? 0,
      };
      const existing = map.get(rel.contactId) ?? [];
      existing.push(tag);
      map.set(rel.contactId, existing);
    }
    return map;
  }

  private mapToContact(row: typeof contacts.$inferSelect, tagList: Tag[]): Contact {
    return {
      id: row.id,
      name: row.name,
      nickname: row.nickname ?? undefined,
      phone: row.phone ?? undefined,
      secondPhone: row.secondPhone ?? undefined,
      wechat: row.wechat ?? undefined,
      tier: row.tier as Contact['tier'],
      memo: row.memo ?? undefined,
      relationshipType: row.relationshipType ?? undefined,
      source: row.source ?? undefined,
      email: row.email ?? undefined,
      company: row.company ?? undefined,
      jobTitle: row.jobTitle ?? undefined,
      address: row.address ?? undefined,
      birthday: row.birthday ? String(row.birthday) : undefined,
      externalId: row.externalId ?? undefined,
      nextFollowupDate: row.nextFollowupDate
        ? String(row.nextFollowupDate)
        : undefined,
      followupNote: row.followupNote ?? undefined,
      archived: row.archived,
      tags: tagList,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapToFollowup(row: typeof followups.$inferSelect): Followup {
    return {
      id: row.id,
      contactId: row.contactId,
      content: row.content,
      followupType: row.followupType ?? 'wechat',
      followupDate: String(row.followupDate),
      nextFollowupDate: row.nextFollowupDate
        ? String(row.nextFollowupDate)
        : undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
