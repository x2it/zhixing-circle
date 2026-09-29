import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { importBatches, contacts, followups, operationLogs, contactTags, mergeLogs } from '@server/database/schema';
import { eq, desc, count, and, inArray, sql } from 'drizzle-orm';
import type {
  ImportBatch,
  ImportBatchListResponse,
  BatchDetailResponse,
  BatchDiffResponse,
  BatchRevertResponse,
  BatchRevertMultiResponse,
  RevertBatchesMultiRequest,
  OperationLogListResponse,
  MergeBatchesRequest,
} from '@shared/api.interface';
import { UserContext } from '@server/common/context/user-context';

@Injectable()
export class BatchesService {
  private readonly logger = new Logger(BatchesService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async findAll(): Promise<ImportBatchListResponse> {
    const userId = UserContext.getUserId();
    const rows = await this.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.userId, userId))
      .orderBy(desc(importBatches.createdAt));

    return {
      items: rows.map((row: typeof importBatches.$inferSelect) => this.mapToImportBatch(row)),
    };
  }

  async findOne(id: string): Promise<ImportBatch> {
    const userId = UserContext.getUserId();
    const [row] = await this.db
      .select()
      .from(importBatches)
      .where(and(eq(importBatches.id, id), eq(importBatches.userId, userId)))
      .limit(1);

    if (!row) {
      throw new NotFoundException('批次不存在');
    }

    return this.mapToImportBatch(row);
  }

  /** 批次详情：含该批次下的联系人清单与跟进数 */
  async getDetail(id: string): Promise<BatchDetailResponse> {
    const userId = UserContext.getUserId();
    const batch = await this.findOne(id);

    const contactRows = await this.db
      .select({
        id: contacts.id,
        name: contacts.name,
        phone: contacts.phone,
        tier: contacts.tier,
        externalId: contacts.externalId,
        createdAt: contacts.createdAt,
        updatedAt: contacts.updatedAt,
      })
      .from(contacts)
      .where(and(eq(contacts.batchId, id), eq(contacts.userId, userId)))
      .orderBy(desc(contacts.createdAt));

    const contactIds = contactRows.map((c: { id: string }) => c.id);
    const followupCountMap = new Map<string, number>();
    if (contactIds.length > 0) {
      const fuRows = await this.db
        .select({ contactId: followups.contactId, cnt: count() })
        .from(followups)
        .where(inArray(followups.contactId, contactIds))
        .groupBy(followups.contactId);
      for (const f of fuRows) {
        followupCountMap.set(f.contactId, Number(f.cnt));
      }
    }

    return {
      batch,
      contacts: contactRows.map(
        (c: {
          id: string;
          name: string;
          phone: string | null;
          tier: string | null;
          externalId: string | null;
          createdAt: Date;
          updatedAt: Date;
        }) => ({
          id: c.id,
          name: c.name,
          phone: c.phone ?? undefined,
          tier: c.tier ?? undefined,
          externalId: c.externalId ?? undefined,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
          followupCount: followupCountMap.get(c.id) ?? 0,
        }),
      ),
      total: contactRows.length,
    };
  }

  /** 回滚预览：告诉用户回滚会发生什么，不实际执行 */
  async getDiff(id: string): Promise<BatchDiffResponse> {
    const userId = UserContext.getUserId();
    const batch = await this.findOne(id);

    if (batch.status === 'reverted') {
      throw new BadRequestException('该批次已回滚，无法重复操作');
    }

    const contactRows = await this.db
      .select({
        id: contacts.id,
        name: contacts.name,
        createdAt: contacts.createdAt,
        updatedAt: contacts.updatedAt,
      })
      .from(contacts)
      .where(and(eq(contacts.batchId, id), eq(contacts.userId, userId)));

    const contactIds = contactRows.map((c: { id: string }) => c.id);
    const followupCountMap = new Map<string, number>();
    if (contactIds.length > 0) {
      const fuRows = await this.db
        .select({ contactId: followups.contactId, cnt: count() })
        .from(followups)
        .where(inArray(followups.contactId, contactIds))
        .groupBy(followups.contactId);
      for (const f of fuRows) {
        followupCountMap.set(f.contactId, Number(f.cnt));
      }
    }

    const deletable: BatchDiffResponse['deletable'] = [];
    const modified: BatchDiffResponse['modified'] = [];

    for (const c of contactRows) {
      const fuCount = followupCountMap.get(c.id) ?? 0;
      // 判定"是否被后续操作改动过"：updatedAt 明显晚于 createdAt（1 秒容差）
      const wasUpdated = c.updatedAt.getTime() - c.createdAt.getTime() > 1000;
      if (fuCount > 0 || wasUpdated) {
        modified.push({
          id: c.id,
          name: c.name,
          reason: fuCount > 0 ? `已有 ${fuCount} 条跟进记录` : '数据已被后续修改',
        });
      } else {
        deletable.push({ id: c.id, name: c.name });
      }
    }

    return {
      batchId: id,
      batchName: batch.name,
      willDelete: deletable.length,
      willKeep: modified.length,
      deletable,
      modified,
      note: '保守回滚：仅删除未被后续操作改动过的数据；已产生跟进或被修改的联系人将保留，需手动确认。',
    };
  }

  /** 保守回滚：只删"干净"的数据，被动过的保留并报告 */
  async revert(id: string): Promise<BatchRevertResponse> {
    const userId = UserContext.getUserId();
    const diff = await this.getDiff(id);

    return this.db.transaction(async (tx) => {
      const deletableIds = diff.deletable.map((d) => d.id);

      if (deletableIds.length > 0) {
        await tx
          .delete(contacts)
          .where(and(inArray(contacts.id, deletableIds), eq(contacts.userId, userId)));
      }

      await tx
        .update(importBatches)
        .set({ status: 'reverted', revertedAt: new Date() })
        .where(and(eq(importBatches.id, id), eq(importBatches.userId, userId)));

      await tx.insert(operationLogs).values({
        userId,
        batchId: id,
        action: 'revert',
        channel: 'web_manual',
        summary: {
          deleted: deletableIds.length,
          kept: diff.willKeep,
          batchName: diff.batchName,
        },
      });

      return {
        success: true,
        deleted: deletableIds.length,
        kept: diff.willKeep,
        keptItems: diff.modified,
      };
    });
  }

  /**
   * 批量回滚（时光机多选/全选）：逐条独立执行单批次回滚逻辑，
   * 单条失败（不存在/已回滚）不影响其余批次，最后汇总每条结果与总删除数。
   */
  async revertMulti(dto: RevertBatchesMultiRequest): Promise<BatchRevertMultiResponse> {
    const userId = UserContext.getUserId();
    const ids = [...new Set((dto.ids ?? []).filter(Boolean))];
    if (ids.length === 0) {
      throw new BadRequestException('请至少选择 1 个要回滚的批次');
    }

    const results: BatchRevertMultiResponse['results'] = [];
    let totalDeleted = 0;
    let totalKept = 0;

    for (const id of ids) {
      try {
        const r = await this.revert(id);
        totalDeleted += r.deleted;
        totalKept += r.kept;
        results.push({ id, success: true, deleted: r.deleted, kept: r.kept });
      } catch (e) {
        const msg = e instanceof BadRequestException || e instanceof NotFoundException
          ? e.message
          : '回滚失败';
        results.push({ id, success: false, deleted: 0, kept: 0, error: msg });
      }
    }

    await this.db.insert(operationLogs).values({
      userId,
      action: 'revert_multi',
      channel: 'web_manual',
      summary: {
        requested: ids.length,
        ok: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        totalDeleted,
        totalKept,
      },
    });

    return { results, totalDeleted, totalKept };
  }

  /** 操作流水 */
  async getOperations(limit = 50): Promise<OperationLogListResponse> {
    const userId = UserContext.getUserId();
    const rows = await this.db
      .select()
      .from(operationLogs)
      .where(eq(operationLogs.userId, userId))
      .orderBy(desc(operationLogs.createdAt))
      .limit(Math.min(limit, 200));

    return {
      items: rows.map((row: typeof operationLogs.$inferSelect) => ({
        id: row.id,
        batchId: row.batchId ?? undefined,
        action: row.action,
        channel: row.channel ?? undefined,
        deviceInfo: row.deviceInfo ?? undefined,
        summary: (row.summary ?? {}) as Record<string, unknown>,
        createdAt: row.createdAt.toISOString(),
      })),
      total: rows.length,
    };
  }

  /** 删除批次（旧接口，保留兼容）
   * - 删除前显式清理 followups / contact_tags / merge_logs，避免依赖数据库级联
   * - 同步清理 operation_logs，避免操作流水残留指向已删除批次
   */
  async remove(id: string): Promise<{ success: boolean; deletedContacts: number }> {
    const userId = UserContext.getUserId();
    return this.db.transaction(async (tx) => {
      const [batch] = await tx
        .select({ id: importBatches.id })
        .from(importBatches)
        .where(and(eq(importBatches.id, id), eq(importBatches.userId, userId)))
        .limit(1);

      if (!batch) {
        throw new NotFoundException('批次不存在');
      }

      const [countResult] = await tx
        .select({ count: count() })
        .from(contacts)
        .where(and(eq(contacts.batchId, id), eq(contacts.userId, userId)));
      const deletedContacts = countResult?.count ?? 0;

      // 级联清理关联数据（不依赖 DB FK，保证任何部署环境行为一致）
      await tx.delete(followups)
        .where(sql`${followups.contactId} IN (SELECT id FROM ${contacts} WHERE batch_id = ${id} AND user_id = ${userId})`);
      await tx.delete(contactTags)
        .where(sql`${contactTags.contactId} IN (SELECT id FROM ${contacts} WHERE batch_id = ${id} AND user_id = ${userId})`);
      await tx.delete(mergeLogs)
        .where(sql`${mergeLogs.keepContactId} IN (SELECT id FROM ${contacts} WHERE batch_id = ${id} AND user_id = ${userId})`);

      await tx.delete(contacts).where(and(eq(contacts.batchId, id), eq(contacts.userId, userId)));
      await tx.delete(operationLogs).where(and(eq(operationLogs.batchId, id), eq(operationLogs.userId, userId)));
      await tx.delete(importBatches).where(and(eq(importBatches.id, id), eq(importBatches.userId, userId)));

      return { success: true, deletedContacts };
    });
  }

  /**
   * 合并批次：把「同一台设备短时间内的 N 个碎片批次」合成一个，
   * 解决 App 每 100 条建一个批次导致的批次列表刷屏、无法管理的问题。
   * 以最早的批次为主（保留其创建时间/设备信息），其余批次的行随之删除。
   */
  async merge(dto: MergeBatchesRequest): Promise<ImportBatch> {
    const userId = UserContext.getUserId();
    const sourceIds = [...new Set((dto.sourceIds ?? []).filter(Boolean))];
    if (sourceIds.length < 2) {
      throw new BadRequestException('至少需要选择 2 个批次');
    }
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(importBatches)
        .where(and(eq(importBatches.userId, userId), inArray(importBatches.id, sourceIds)));

      // 只允许合并未回滚批次（已回滚的批次联系人已被撤走，混入会破坏追溯链）
      // 注意口径与列表一致：列表把 NULL status 显示为 active（历史批次无状态值），
      // 这里必须同样按「非 reverted 即可合并」判断，否则用户看得到、选得了、合不动。
      const active = rows.filter(r => (r.status ?? 'active') !== 'reverted');
      if (active.length < 2) {
        throw new BadRequestException('可合并的批次不足 2 个（已回滚批次不支持合并）');
      }
      active.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
      const main = active[0];
      const others = active.slice(1);
      const otherIds = others.map(r => r.id);

      // 联系人改挂主批次。刻意不改 updatedAt：合并只是归属调整，不是数据变更，
      // 若刷新时间戳，之后对主批次做时光机回滚时所有联系人都被误判为「已被修改」而无法清理。
      const moved = await tx
        .update(contacts)
        .set({ batchId: main.id })
        .where(and(eq(contacts.userId, userId), inArray(contacts.batchId, otherIds)))
        .returning({ id: contacts.id });

      // 主批次重算人数（DB 实际值，避免计数漂移）
      const [{ realCount }] = await tx
        .select({ realCount: count() })
        .from(contacts)
        .where(and(eq(contacts.batchId, main.id), eq(contacts.userId, userId)));

      const [updatedMain] = await tx
        .update(importBatches)
        .set({
          name: dto.name?.trim() || main.name,
          contactCount: realCount ?? 0,
          updatedAt: new Date(),
        })
        .where(and(eq(importBatches.id, main.id), eq(importBatches.userId, userId)))
        .returning();

      // 其余批次行删除，操作流水改挂主批次，避免残留空批次卡片
      await tx
        .update(operationLogs)
        .set({ batchId: main.id })
        .where(and(eq(operationLogs.userId, userId), inArray(operationLogs.batchId, otherIds)));
      await tx.delete(importBatches).where(and(eq(importBatches.userId, userId), inArray(importBatches.id, otherIds)));

      await tx.insert(operationLogs).values({
        userId,
        batchId: main.id,
        action: 'batches_merge',
        channel: 'web',
        summary: {
          mergedFrom: otherIds,
          mergedNames: others.map(r => r.name),
          into: main.id,
          movedContacts: moved.length,
        },
      });

      return this.mapToImportBatch(updatedMain);
    });
  }

  private mapToImportBatch(row: typeof importBatches.$inferSelect): ImportBatch {
    return {
      id: row.id,
      name: row.name,
      source: row.source ?? undefined,
      contactCount: row.contactCount,
      createdAt: row.createdAt.toISOString(),
      channel: row.channel ?? undefined,
      deviceInfo: row.deviceInfo ?? undefined,
      status: (row.status as 'active' | 'reverted') ?? 'active',
      contactCreated: row.contactCreated,
      contactUpdated: row.contactUpdated,
      contactSkipped: row.contactSkipped,
      followupCount: row.followupCount,
      messageCount: row.messageCount,
      revertedAt: row.revertedAt ? row.revertedAt.toISOString() : undefined,
    };
  }
}
