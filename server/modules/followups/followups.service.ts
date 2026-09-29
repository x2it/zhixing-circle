import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { followups, contacts, operationLogs } from '@server/database/schema';
import type { Followup, CreateFollowupRequest, BatchCreateFollowupsRequest, BatchCreateResult } from '@shared/api.interface';
import { UserContext } from '@server/common/context/user-context';

type FollowupRow = typeof followups.$inferSelect;

/** 批量接口单次上限 */
const BATCH_LIMIT = 100;

@Injectable()
export class FollowupsService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  private mapFollowup(row: FollowupRow): Followup {
    return {
      id: row.id,
      contactId: row.contactId,
      content: row.content,
      followupType: row.followupType ?? 'wechat',
      followupDate: row.followupDate,
      nextFollowupDate: row.nextFollowupDate ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listByContact(contactId: string): Promise<Followup[]> {
    const userId = UserContext.getUserId();
    const rows: FollowupRow[] = await this.db
      .select()
      .from(followups)
      .where(and(eq(followups.contactId, contactId), eq(followups.userId, userId)))
      .orderBy(desc(followups.followupDate), desc(followups.createdAt));
    return rows.map((row: FollowupRow) => this.mapFollowup(row));
  }

  /** 按联系人查询跟进记录，不传 contactId 时返回全部（分页由调用方使用） */
  async listAll(query: { contactId?: string; page?: number; pageSize?: number }) {
    const userId = UserContext.getUserId();
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize =
      query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, 200) : 50;
    const offset = (page - 1) * pageSize;

    const conditions = [eq(followups.userId, userId)];
    if (query.contactId) {
      conditions.push(eq(followups.contactId, query.contactId));
    }

    const rows = await this.db
      .select()
      .from(followups)
      .where(and(...conditions))
      .orderBy(desc(followups.createdAt))
      .limit(pageSize)
      .offset(offset);

    return rows.map((row: FollowupRow) => this.mapFollowup(row));
  }

  async create(contactId: string, dto: CreateFollowupRequest): Promise<Followup> {
    const userId = UserContext.getUserId();
    // 校验联系人存在且属于当前用户
    const [existing] = await this.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.userId, userId)))
      .limit(1);
    if (!existing) {
      throw new NotFoundException('联系人不存在');
    }

    const insertData: typeof followups.$inferInsert = {
      userId,
      contactId,
      content: dto.content,
      followupType: dto.followupType,
      followupDate: dto.followupDate,
      nextFollowupDate: dto.nextFollowupDate ?? null,
    };

    const [created] = await this.db.transaction(async (tx) => {
      const result = await tx.insert(followups).values(insertData).returning();
      if (dto.nextFollowupDate) {
        await tx
          .update(contacts)
          .set({ nextFollowupDate: dto.nextFollowupDate })
          .where(eq(contacts.id, contactId));
      }
      return result;
    });

    return this.mapFollowup(created);
  }

  /** 批量创建跟进（App 同步用）：单条失败不影响其它 */
  async batchCreate(dto: BatchCreateFollowupsRequest): Promise<BatchCreateResult<Followup>> {
    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException('items 不能为空');
    }
    if (dto.items.length > BATCH_LIMIT) {
      throw new BadRequestException(`单次批量最多 ${BATCH_LIMIT} 条`);
    }

    const items: Followup[] = [];
    const errors: Array<{ index: number; message: string }> = [];

    for (let i = 0; i < dto.items.length; i++) {
      const item = dto.items[i];
      try {
        if (!item.contactId) throw new BadRequestException('contactId 不能为空');
        if (!item.content) throw new BadRequestException('content 不能为空');
        items.push(await this.create(item.contactId, item));
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : '创建失败';
        errors.push({ index: i, message });
      }
    }

    // 记录操作流水（跟进数据可追溯）
    try {
      const userId = UserContext.getUserId();
      const batchName = dto.batchName?.trim() || this.buildBatchName('App跟进同步');
      await this.db.insert(operationLogs).values({
        userId,
        action: 'batch_sync',
        channel: 'app_sync',
        deviceInfo: dto.deviceInfo ?? undefined,
        summary: { total: dto.items.length, created: items.length, failed: errors.length, batchName },
      });
    } catch {
      // 流水记录失败不影响主流程
    }

    return { items, errors: errors.length ? errors : undefined, created: items.length };
  }

  private buildBatchName(prefix: string): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${prefix} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async update(id: string, dto: Partial<CreateFollowupRequest>): Promise<Followup> {
    const userId = UserContext.getUserId();
    const patch: Partial<typeof followups.$inferInsert> = {};
    if (dto.content !== undefined) patch.content = dto.content;
    if (dto.followupType !== undefined) patch.followupType = dto.followupType;
    if (dto.followupDate !== undefined) patch.followupDate = dto.followupDate;
    if (dto.nextFollowupDate !== undefined) patch.nextFollowupDate = dto.nextFollowupDate;
    // 更新时自动刷新更新时间（时间戳用于多端合并时判断最新）
    patch.updatedAt = new Date();

    if (Object.keys(patch).length === 0) {
      throw new NotFoundException('未提供可更新字段');
    }

    const [updated] = await this.db
      .update(followups)
      .set(patch)
      .where(and(eq(followups.id, id), eq(followups.userId, userId)))
      .returning();

    if (!updated) {
      throw new NotFoundException('跟进记录不存在');
    }

    // 如果更新了 nextFollowupDate，同步更新联系人的下次跟进时间
    if (dto.nextFollowupDate) {
      await this.db
        .update(contacts)
        .set({ nextFollowupDate: dto.nextFollowupDate })
        .where(and(eq(contacts.id, updated.contactId), eq(contacts.userId, userId)));
    }

    return this.mapFollowup(updated);
  }

  async remove(id: string): Promise<{ success: boolean }> {
    const userId = UserContext.getUserId();
    const [deleted] = await this.db
      .delete(followups)
      .where(and(eq(followups.id, id), eq(followups.userId, userId)))
      .returning({ id: followups.id });

    if (!deleted) {
      throw new NotFoundException('跟进记录不存在');
    }

    return { success: true };
  }

  /** 批量删除跟进（数据清理用） */
  async removeByContactIds(contactIds: string[], userId: string): Promise<void> {
    if (contactIds.length === 0) return;
    await this.db
      .delete(followups)
      .where(and(inArray(followups.contactId, contactIds), eq(followups.userId, userId)));
  }
}
