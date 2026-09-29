import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, desc, asc, sql, and, gte, lte, isNotNull, inArray } from 'drizzle-orm';
import { contacts, followups, contactTags, tags } from '@server/database/schema';
import type {
  DashboardStats,
  TierContactGroup,
  ContactTier,
  Contact,
  Tag,
  Followup,
} from '@shared/api.interface';
import { UserContext } from '@server/common/context/user-context';

type ContactRow = typeof contacts.$inferSelect;
type TagRow = typeof tags.$inferSelect;
type FollowupRow = typeof followups.$inferSelect;

@Injectable()
export class DashboardService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  private mapTag(row: TagRow): Tag {
    return {
      id: row.id,
      name: row.name,
      category: (row.category ?? 'custom') as Tag['category'],
      color: row.color ?? '#64748b',
      sortOrder: row.sortOrder ?? 0,
    };
  }

  private mapContact(row: ContactRow, contactTags: Tag[]): Contact {
    return {
      id: row.id,
      name: row.name,
      nickname: row.nickname ?? undefined,
      phone: row.phone ?? undefined,
      wechat: row.wechat ?? undefined,
      tier: row.tier as ContactTier,
      memo: row.memo ?? undefined,
      nextFollowupDate: row.nextFollowupDate ?? undefined,
      followupNote: row.followupNote ?? undefined,
      tags: contactTags,
      archived: row.archived,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

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

  private async loadTagsForContacts(contactIds: string[]): Promise<Map<string, Tag[]>> {
    const byContact = new Map<string, Tag[]>();
    if (contactIds.length === 0) return byContact;

    const rows = await this.db
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
      .where(inArray(contactTags.contactId, contactIds));

    for (const row of rows) {
      const tag: Tag = {
        id: row.tagId,
        name: row.tagName,
        category: (row.tagCategory ?? 'custom') as Tag['category'],
        color: row.tagColor ?? '#64748b',
        sortOrder: row.tagSortOrder ?? 0,
      };
      const existing = byContact.get(row.contactId) ?? [];
      existing.push(tag);
      byContact.set(row.contactId, existing);
    }

    return byContact;
  }

  private getWeekRange(): { start: string; end: string } {
    const now = new Date();
    const dayOfWeek = now.getDay();
    // Sunday = 0, Monday = 1, ..., Saturday = 6
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const formatDate = (d: Date): string => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    return { start: formatDate(monday), end: formatDate(sunday) };
  }

  private getToday(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private buildBaseConditions(batchId?: string) {
    const conditions = [eq(contacts.archived, false), eq(contacts.userId, UserContext.getUserId())];
    if (batchId) {
      conditions.push(eq(contacts.batchId, batchId));
    }
    return and(...conditions);
  }

  async getStats(batchId?: string): Promise<DashboardStats> {
    const { start: weekStart, end: weekEnd } = this.getWeekRange();
    const baseWhere = this.buildBaseConditions(batchId);

    const [totalResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(contacts)
      .where(baseWhere);

    const [tierSResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(contacts)
      .where(and(baseWhere, eq(contacts.tier, 'S')));

    const [tierAResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(contacts)
      .where(and(baseWhere, eq(contacts.tier, 'A')));

    const [tierVResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(contacts)
      .where(and(baseWhere, eq(contacts.tier, 'V')));

    const [weekResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(contacts)
      .where(and(
        baseWhere,
        isNotNull(contacts.nextFollowupDate),
        gte(contacts.nextFollowupDate, weekStart),
        lte(contacts.nextFollowupDate, weekEnd),
      ));

    // 全量分层分布（一次 groupBy 查询，S/A/B/C/D/V 六层固定键全量回显）
    const tierRows = await this.db
      .select({ tier: contacts.tier, count: sql<number>`count(*)` })
      .from(contacts)
      .where(baseWhere)
      .groupBy(contacts.tier);
    const tierCountMap = new Map<string, number>(
      tierRows.map((r: { tier: string; count: number }) => [r.tier, Number(r.count)]),
    );
    const tierDistribution = Object.fromEntries(
      (['S', 'A', 'B', 'C', 'D', 'V'] as ContactTier[]).map((t) => [t, tierCountMap.get(t) ?? 0]),
    ) as Record<ContactTier, number>;

    return {
      totalContacts: Number(totalResult.count),
      tierSCount: Number(tierSResult.count),
      tierACount: Number(tierAResult.count),
      tierVCount: Number(tierVResult.count),
      weekFollowupCount: Number(weekResult.count),
      tierDistribution,
    };
  }

  async getTierGroups(batchId?: string): Promise<TierContactGroup[]> {
    const tiers: Array<{ tier: ContactTier; label: string }> = [
      { tier: 'S', label: 'S类 成交高价值' },
      { tier: 'A', label: 'A类 高意向' },
      { tier: 'B', label: 'B类 已接触' },
      { tier: 'C', label: 'C类 信息完整' },
      { tier: 'D', label: 'D类 线索' },
      { tier: 'V', label: 'V类 已成交' },
    ];

    const baseWhere = this.buildBaseConditions(batchId);

    const countRows = await this.db
      .select({
        tier: contacts.tier,
        count: sql<number>`count(*)`,
      })
      .from(contacts)
      .where(baseWhere)
      .groupBy(contacts.tier);

    const countMap = new Map<string, number>();
    for (const row of countRows) {
      countMap.set(row.tier, Number(row.count));
    }

    const previewLimit = 10;
    const allPreviewContacts: ContactRow[] = [];
    for (const { tier } of tiers) {
      const tierRows = await this.db
        .select()
        .from(contacts)
        .where(and(baseWhere, eq(contacts.tier, tier)))
        .orderBy(desc(contacts.updatedAt))
        .limit(previewLimit);
      allPreviewContacts.push(...tierRows);
    }

    const contactIds = allPreviewContacts.map((c: ContactRow) => c.id);
    const tagsMap = await this.loadTagsForContacts(contactIds);

    const groups: TierContactGroup[] = tiers.map(({ tier, label }) => {
      const tierContacts = allPreviewContacts
        .filter((c: ContactRow) => c.tier === tier)
        .map((row: ContactRow) => this.mapContact(row, tagsMap.get(row.id) ?? []));
      return { tier, label, count: countMap.get(tier) ?? 0, contacts: tierContacts };
    });

    return groups;
  }

  async getTodayFollowups(batchId?: string): Promise<Contact[]> {
    const today = this.getToday();
    const baseWhere = this.buildBaseConditions(batchId);

    const rows: ContactRow[] = await this.db
      .select()
      .from(contacts)
      .where(and(
        baseWhere,
        isNotNull(contacts.nextFollowupDate),
        lte(contacts.nextFollowupDate, today),
      ))
      .orderBy(asc(contacts.nextFollowupDate));

    const contactIds = rows.map((r: ContactRow) => r.id);
    const tagsMap = await this.loadTagsForContacts(contactIds);

    return rows.map((row: ContactRow) =>
      this.mapContact(row, tagsMap.get(row.id) ?? [])
    );
  }

  async getRecentActivities(): Promise<Array<Followup & { contactName: string }>> {
    const rows = await this.db
      .select({
        followup: followups,
        contactName: contacts.name,
      })
      .from(followups)
      .innerJoin(contacts, eq(followups.contactId, contacts.id))
      .where(eq(followups.userId, UserContext.getUserId()))
      .orderBy(desc(followups.createdAt))
      .limit(20);

    return rows.map((row) => ({
      ...this.mapFollowup(row.followup),
      contactName: row.contactName,
    }));
  }
}
