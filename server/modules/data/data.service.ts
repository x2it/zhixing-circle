import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, sql, inArray, gt, gte, lt, and, isNull, isNotNull, count, desc, or } from 'drizzle-orm';
import { contacts, tags, contactTags, followups, importBatches, mergeLogs, messages, calls, operationLogs } from '@server/database/schema';
import type {
  ExportData,
  Contact,
  Tag,
  Followup,
  ContactTier,
  TagCategory,
  DataQualityStats,
  DedupPreviewResponse,
  DedupExecuteRequest,
  DedupExecuteResponse,
  CommDedupPreviewResponse,
  CommDedupStat,
  CommDedupExecuteRequest,
  CommDedupExecuteResponse,
  DataCleanDuplicateGroup,
  PhoneNormalizeResult,
  TierSuggestionResponse,
  TierSuggestionApplyRequest,
  NicknameCleanPreviewRequest,
  NicknameCleanPreviewResponse,
  NicknameCleanExecuteRequest,
  NicknameCleanExecuteResponse,
  TagInferPreviewRequest,
  TagInferPreviewResponse,
  TagInferApplyRequest,
  TagInferApplyResponse,
  TagInferItem,
  TierSuggestion,
  NicknameCleanOperation,
  XlsxImportRequest,
  XlsxImportResponse,
  ImportBatch,
  MergeLog,
  MergeLogListResponse,
  BatchTierUpdateRequest,
  BatchTagRequest,
  BatchDeleteNoPhoneResponse,
  WorkAppExcelImportRequest,
  ContactImportRequest,
  ImportMode,
  DuplicateStrategy,
  ImportResult,
} from '@shared/api.interface';
import { UserContext } from '@server/common/context/user-context';

type ContactRow = typeof contacts.$inferSelect;
type TagRow = typeof tags.$inferSelect;
type FollowupRow = typeof followups.$inferSelect;

@Injectable()
export class DataService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  private mapTag(row: TagRow): Tag {
    return {
      id: row.id,
      name: row.name,
      category: (row.category ?? 'custom') as TagCategory,
      color: row.color ?? '#64748b',
      sortOrder: row.sortOrder ?? 0,
    };
  }

  private mapContact(row: ContactRow, contactTagsList: Tag[]): Contact {
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
      tags: contactTagsList,
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

  private async loadContactsWithTags(options?: { batchId?: string; includeArchived?: boolean }): Promise<Contact[]> {
    const conditions = [eq(contacts.userId, UserContext.getUserId())];
    if (!options?.includeArchived) {
      conditions.push(eq(contacts.archived, false));
    }
    if (options?.batchId) {
      conditions.push(eq(contacts.batchId, options.batchId));
    }

    const allContacts: ContactRow[] = await this.db
      .select()
      .from(contacts)
      .where(and(...conditions));

    if (allContacts.length === 0) return [];

    const contactIds = allContacts.map((c: ContactRow) => c.id);
    const tagRows = await this.db
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

    const tagsByContact = new Map<string, Tag[]>();
    for (const row of tagRows) {
      const tag: Tag = {
        id: row.tagId,
        name: row.tagName,
        category: (row.tagCategory ?? 'custom') as TagCategory,
        color: row.tagColor ?? '#64748b',
        sortOrder: row.tagSortOrder ?? 0,
      };
      const existing = tagsByContact.get(row.contactId) ?? [];
      existing.push(tag);
      tagsByContact.set(row.contactId, existing);
    }

    return allContacts.map((row: ContactRow) =>
      this.mapContact(row, tagsByContact.get(row.id) ?? [])
    );
  }

  async exportJson(options?: { batchId?: string; includeArchived?: boolean }): Promise<ExportData> {
    const userId = UserContext.getUserId();
    const [contactList, tagList, followupList] = await Promise.all([
      this.loadContactsWithTags(options),
      this.db.select().from(tags).where(eq(tags.userId, userId)).then((rows: TagRow[]) => rows.map((r: TagRow) => this.mapTag(r))),
      this.db.select().from(followups).where(eq(followups.userId, userId)).then((rows: FollowupRow[]) => rows.map((r: FollowupRow) => this.mapFollowup(r))),
    ]);

    return {
      contacts: contactList,
      tags: tagList,
      followups: followupList,
      exportedAt: new Date().toISOString(),
      version: '1.0.0',
    };
  }

  async exportCsv(options?: { batchId?: string; includeArchived?: boolean }): Promise<string> {
    const contactList = await this.loadContactsWithTags(options);

    const header = ['姓名', '备注名', '电话', '微信', '层级', '备忘', '下次跟进时间', '标签', '跟进备注'];
    const escapeCsv = (value: string | undefined): string => {
      if (value === undefined || value === null) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const lines: string[] = [header.join(',')];
    for (const contact of contactList) {
      const tagNames = contact.tags.map((t: Tag) => t.name).join('、');
      const row = [
        escapeCsv(contact.name),
        escapeCsv(contact.nickname),
        escapeCsv(contact.phone),
        escapeCsv(contact.wechat),
        escapeCsv(contact.tier),
        escapeCsv(contact.memo),
        escapeCsv(contact.nextFollowupDate),
        escapeCsv(tagNames),
        escapeCsv(contact.followupNote),
      ];
      lines.push(row.join(','));
    }

    // BOM + CSV content for Excel Chinese compatibility
    const bom = '\uFEFF';
    return bom + lines.join('\n');
  }

  async importJson(data: ExportData): Promise<{ success: boolean; imported: { contacts: number; tags: number; followups: number } }> {
    const userId = UserContext.getUserId();
    const result = await this.db.transaction(async (tx) => {
      // 清空当前用户的数据（按依赖顺序反序删除, 多用户下不触碰他人数据）
      // 同时清追溯层：批次 / 操作流水 / 合并记录 / 短信，保证导入后「数据时光机」从干净状态重新计数
      await tx.delete(followups).where(eq(followups.userId, userId));
      await tx.delete(messages).where(eq(messages.userId, userId));
      await tx.delete(mergeLogs).where(eq(mergeLogs.userId, userId));
      await tx.delete(contactTags).where(sql`${contactTags.contactId} IN (SELECT id FROM contacts WHERE user_id = ${userId})`);
      await tx.delete(contacts).where(eq(contacts.userId, userId));
      await tx.delete(tags).where(eq(tags.userId, userId));
      await tx.delete(operationLogs).where(eq(operationLogs.userId, userId));
      await tx.delete(importBatches).where(eq(importBatches.userId, userId));

      let tagsCount = 0;
      let contactsCount = 0;
      let followupsCount = 0;

      // 导入标签
      if (data.tags && data.tags.length > 0) {
        const tagInserts = data.tags.map((tag: Tag) => ({
          id: tag.id,
          userId,
          name: tag.name,
          category: tag.category,
          color: tag.color,
          sortOrder: tag.sortOrder,
        }));
        await tx.insert(tags).values(tagInserts);
        tagsCount = tagInserts.length;
      }

      // 导入联系人
      if (data.contacts && data.contacts.length > 0) {
        const contactInserts = data.contacts.map((contact: Contact) => ({
          id: contact.id,
          userId,
          name: contact.name,
          nickname: contact.nickname ?? null,
          phone: contact.phone ?? null,
          wechat: contact.wechat ?? null,
          tier: contact.tier,
          memo: contact.memo ?? null,
          nextFollowupDate: contact.nextFollowupDate ?? null,
          followupNote: contact.followupNote ?? null,
        }));
        await tx.insert(contacts).values(contactInserts);
        contactsCount = contactInserts.length;

        // 导入联系人-标签关联
        const tagRelations: Array<{ contactId: string; tagId: string }> = [];
        for (const contact of data.contacts) {
          if (contact.tags && contact.tags.length > 0) {
            for (const tag of contact.tags) {
              tagRelations.push({ contactId: contact.id, tagId: tag.id });
            }
          }
        }
        if (tagRelations.length > 0) {
          await tx.insert(contactTags).values(tagRelations);
        }
      }

      // 导入跟进记录
      if (data.followups && data.followups.length > 0) {
        const followupInserts = data.followups.map((f: Followup) => ({
          id: f.id,
          userId,
          contactId: f.contactId,
          content: f.content,
          followupType: f.followupType,
          followupDate: f.followupDate,
          nextFollowupDate: f.nextFollowupDate ?? null,
        }));
        await tx.insert(followups).values(followupInserts);
        followupsCount = followupInserts.length;
      }

      return { contacts: contactsCount, tags: tagsCount, followups: followupsCount };
    });

    return { success: true, imported: result };
  }

  // ========== Data Quality ==========

  async getQualityStats(): Promise<DataQualityStats> {
    const validTiers: string[] = ['S', 'A', 'B', 'C', 'D', 'V'];
    const uid = UserContext.getUserId();
    const archivedMine = and(eq(contacts.archived, false), eq(contacts.userId, uid));

    const [totalResult, missingPhoneResult, missingTierResult, invalidPhoneResult, missingTagResult] = await Promise.all([
      this.db.select({ count: count() }).from(contacts).where(archivedMine),
      this.db.select({ count: count() }).from(contacts).where(and(archivedMine, isNull(contacts.phone))),
      this.db.select({ count: count() }).from(contacts).where(and(archivedMine, sql`${contacts.tier} IS NULL OR ${contacts.tier} NOT IN (${sql.join(validTiers.map(t => sql`${t}`), sql`, `)})`)),
      this.db.select({ count: count() }).from(contacts).where(and(archivedMine, isNotNull(contacts.phone), sql`${contacts.phone} !~ '^1\\d{10}$'`)),
      this.db.select({ count: sql<number>`count(DISTINCT ${contacts.id})` }).from(contacts)
        .leftJoin(contactTags, eq(contacts.id, contactTags.contactId))
        .where(and(archivedMine, isNull(contactTags.tagId))),
    ]);

    // Duplicate phone count: groups with count > 1
    const dupGroups = await this.db.select({ phone: contacts.phone, cnt: count() })
      .from(contacts)
      .where(and(archivedMine, isNotNull(contacts.phone)))
      .groupBy(contacts.phone)
      .having(sql`count(*) > 1`);

    return {
      totalContacts: Number(totalResult[0]?.count ?? 0),
      duplicatePhoneCount: dupGroups.length,
      missingPhoneCount: Number(missingPhoneResult[0]?.count ?? 0),
      missingTierCount: Number(missingTierResult[0]?.count ?? 0),
      missingTagCount: Number(missingTagResult[0]?.count ?? 0),
      invalidPhoneCount: Number(invalidPhoneResult[0]?.count ?? 0),
    };
  }

  // ========== Dedup ==========

  // Levenshtein distance for name similarity
  private levenshtein(a: string, b: string): number {
    const m: number = a.length;
    const n: number = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp: number[] = new Array(n + 1);
    for (let j: number = 0; j <= n; j++) dp[j] = j;
    for (let i: number = 1; i <= m; i++) {
      let prev: number = dp[0];
      dp[0] = i;
      for (let j: number = 1; j <= n; j++) {
        const temp: number = dp[j];
        if (a[i - 1] === b[j - 1]) {
          dp[j] = prev;
        } else {
          dp[j] = Math.min(prev + 1, dp[j] + 1, dp[j - 1] + 1);
        }
        prev = temp;
      }
    }
    return dp[n];
  }

  // Check if shortName is a nickname/abbreviation of fullName (e.g. 张总 vs 张伟)
  private isNickname(shortName: string, fullName: string): boolean {
    if (shortName.length === 0 || fullName.length === 0) return false;
    if (shortName.length >= fullName.length) return false;
    // Same surname (first char) and short name has 1 common char with full name after surname
    if (shortName[0] === fullName[0]) {
      // e.g. 张总 vs 张伟 -> same surname, total length 2 vs 2 -> check short has "总" suffix honorific
      const honorifics: string[] = ['总', '哥', '姐', '先生', '女士', '老师', '工', '经理', '主管'];
      for (const h of honorifics) {
        if (shortName.endsWith(h) && shortName.length - h.length >= 1) {
          const base: string = shortName.slice(0, shortName.length - h.length);
          // base should be prefix of fullName (at least surname + one given name char)
          if (fullName.startsWith(base) && base.length >= 1) return true;
        }
      }
      // short name is surname + one given char, full name has more given chars
      if (shortName.length === 2 && fullName.length >= 2 && fullName.startsWith(shortName)) {
        return true;
      }
    }
    return false;
  }

  private computeInfoScore(
    c: { id: string; name: string; phone: string | null; wechat: string | null; memo: string | null },
    followupCountMap: Map<string, number>,
    tagCountMap: Map<string, number>,
  ): number {
    let score = 0;
    if (c.name) score += 1;
    if (c.wechat) score += 1;
    if (c.memo) score += 1;
    if ((followupCountMap.get(c.id) ?? 0) > 0) score += 1;
    if ((tagCountMap.get(c.id) ?? 0) > 0) score += 1;
    return score;
  }

  async getDedupPreview(): Promise<DedupPreviewResponse> {
    // Query all non-archived contacts with basic info（仅当前用户）
    const allContacts = await this.db
      .select({
        id: contacts.id,
        name: contacts.name,
        phone: contacts.phone,
        wechat: contacts.wechat,
        memo: contacts.memo,
      })
      .from(contacts)
      .where(and(eq(contacts.archived, false), eq(contacts.userId, UserContext.getUserId())));

    if (allContacts.length === 0) {
      return { groups: [], totalExactGroups: 0, totalSuspectedGroups: 0, totalDuplicateContacts: 0 };
    }

    const allIds = allContacts.map((c: { id: string; name: string; phone: string | null; wechat: string | null; memo: string | null }) => c.id);

    // Get followup counts for all contacts
    const followupCounts = await this.db
      .select({ contactId: followups.contactId, cnt: count() })
      .from(followups)
      .where(inArray(followups.contactId, allIds))
      .groupBy(followups.contactId);
    const followupCountMap = new Map<string, number>();
    for (const f of followupCounts) {
      followupCountMap.set(f.contactId, Number(f.cnt));
    }

    // Get tag counts for all contacts
    const tagCounts = await this.db
      .select({ contactId: contactTags.contactId, cnt: count() })
      .from(contactTags)
      .where(inArray(contactTags.contactId, allIds))
      .groupBy(contactTags.contactId);
    const tagCountMap = new Map<string, number>();
    for (const t of tagCounts) {
      tagCountMap.set(t.contactId, Number(t.cnt));
    }

    // ========== Phone duplicate groups (exact) ==========
    const byPhone = new Map<string, typeof allContacts>();
    for (const c of allContacts) {
      if (!c.phone) continue;
      const arr = byPhone.get(c.phone) ?? [];
      arr.push(c);
      byPhone.set(c.phone, arr);
    }

    const phoneGroups: Array<{ phone: string; contacts: typeof allContacts }> = [];
    for (const [phone, list] of byPhone) {
      if (list.length > 1) {
        phoneGroups.push({ phone, contacts: list });
      }
    }

    const phoneDupContactIds = new Set<string>();
    for (const g of phoneGroups) {
      for (const c of g.contacts) phoneDupContactIds.add(c.id);
    }

    const exactGroups = phoneGroups.map((g: { phone: string; contacts: typeof allContacts }, idx: number) => {
      const groupContacts = g.contacts;
      const infoScores = groupContacts.map((c: { id: string; name: string; phone: string | null; wechat: string | null; memo: string | null }) =>
        this.computeInfoScore(c, followupCountMap, tagCountMap)
      );
      return {
        groupKey: `phone-${idx}`,
        type: 'exact' as const,
        matchField: 'phone' as const,
        matchValue: g.phone,
        dedupType: 'phone' as const,
        contacts: groupContacts.map((c: { id: string; name: string; phone: string | null; wechat: string | null; memo: string | null }, i: number) => ({
          id: c.id,
          name: c.name,
          phone: c.phone ?? undefined,
          wechat: c.wechat ?? undefined,
          memo: c.memo ?? undefined,
          followupCount: followupCountMap.get(c.id) ?? 0,
          tagCount: tagCountMap.get(c.id) ?? 0,
          infoScore: infoScores[i],
        })),
      };
    });

    // ========== Name similarity groups (suspected) ==========
    const nameSimilarityGroups: DataCleanDuplicateGroup[] = [];
    const usedInNameGroup = new Set<string>();

    const CHINESE_SURNAMES: string[] = [
      '李','王','张','刘','陈','杨','黄','赵','周','吴','徐','孙','胡','朱','高','林','何','郭','马','罗',
      '梁','宋','郑','谢','韩','唐','冯','于','董','萧','程','曹','袁','邓','许','傅','沈','曾','彭','吕',
      '苏','卢','蒋','蔡','贾','丁','魏','薛','叶','阎','余','潘','杜','戴','夏','钟','汪','田','任','姜',
      '范','方','石','姚','谭','廖','邹','熊','金','陆','郝','孔','白','崔','康','毛','邱','秦','江','史',
      '顾','侯','邵','孟','龙','万','段','雷','钱','汤','尹','黎','易','常','武','乔','贺','赖','龚','文',
    ];
    const HONORIFICS: string[] = ['总','哥','姐','先生','女士','老师','工','经理','主管','大爹','妈','叔','姨','伯','婶','兄','妹','弟','姐家','哥家'];

    // Extract person name core: surname + given name chars, strip prefix/tier/suffix/description
    const extractPersonName = (raw: string): { surname: string; given: string; full: string; hasHonorific: boolean } | null => {
      let s: string = raw.replace(/\s+/g, '');
      // Strip common tier/prefix patterns: A·, 2·, 1., 1-, S/
      s = s.replace(/^[A-Za-z0-9]+[·\.．\-\/、]/, '');
      // Strip description in parentheses: （别墅）(看地皮)
      s = s.replace(/[（(][^)）]*[)）]/g, '');
      // If it contains obvious non-person words, skip
      const nonPersonPatterns = ['房东','小区','别墅','地皮','商铺','土地','农家乐','装修','物业','找房','宽带','先生看','看土地','看小区','看宅基地','看农家乐','要租','租商铺','租农家乐','交房','同事','朋友','古城','普洱','景谷','普洱','古城','茶马','公馆','鼎城','国际','印象','时光澜庭','中梁','壹号院','清香苑','锦苑','家园','花园','小区','公馆','公寓','毛坯','学区房','工程抵','工抵房','款项','托管'];
      for (const pat of nonPersonPatterns) {
        if (s.includes(pat)) return null;
      }
      // If too long, probably not a person name
      if (s.length > 8) return null;

      // Find surname
      let surname = '';
      for (const sn of CHINESE_SURNAMES) {
        if (s.startsWith(sn)) {
          surname = sn;
          break;
        }
      }
      if (!surname) return null;

      const rest = s.slice(surname.length);
      let given = rest;
      let hasHonorific = false;
      for (const h of HONORIFICS) {
        if (given.endsWith(h)) {
          given = given.slice(0, given.length - h.length);
          hasHonorific = true;
          break;
        }
      }
      if (given.length === 0 && !hasHonorific) return null;
      if (given.length > 4) return null; // given name too long, probably description

      return { surname, given, full: surname + given, hasHonorific };
    };

    const areSimilarNames = (
      a: { surname: string; given: string; full: string; hasHonorific: boolean },
      b: { surname: string; given: string; full: string; hasHonorific: boolean }
    ): boolean => {
      if (a.surname !== b.surname) return false;
      // Both have no given name (just 张总 + 张姐) -> NOT similar, too broad
      if (a.given.length === 0 && b.given.length === 0) return false;
      // One has no given name (张总) + other has 1-char given (张伟) -> only if given char matches the honorific base pattern
      // e.g. 张总 vs 张伟 -> not similar ("总" is honorific, not given name)
      if (a.given.length === 0 || b.given.length === 0) return false;

      const maxLen = Math.max(a.given.length, b.given.length);
      const minLen = Math.min(a.given.length, b.given.length);
      const dist = this.levenshtein(a.given, b.given);
      const similarity = maxLen > 0 ? 1 - dist / maxLen : 0;

      // Same given name -> definitely same person
      if (a.given === b.given) return true;
      // 1-char given: must be exact
      if (minLen === 1) return false;
      // 2-char given: first char must match AND similarity >= 50% (at least 1 char same)
      if (minLen === 2) return similarity >= 0.5 && a.given[0] === b.given[0];
      // 3+ chars: >= 0.6 similarity
      return similarity >= 0.6;
    };

    const parsedContacts = allContacts.map((c: { id: string; name: string; phone: string | null; wechat: string | null; memo: string | null }) => ({
      contact: c,
      parsed: extractPersonName(c.name),
    }));

    for (let i = 0; i < parsedContacts.length && nameSimilarityGroups.length < 50; i++) {
      const pi = parsedContacts[i];
      if (!pi.parsed) continue;
      if (usedInNameGroup.has(pi.contact.id)) continue;

      const similar: typeof allContacts = [];

      for (let j = i + 1; j < parsedContacts.length; j++) {
        const pj = parsedContacts[j];
        if (!pj.parsed) continue;
        // Skip pairs that share the same phone (already in phone groups)
        if (pi.contact.phone && pj.contact.phone && pi.contact.phone === pj.contact.phone) continue;

        if (areSimilarNames(pi.parsed, pj.parsed)) {
          similar.push(pj.contact);
        }
      }

      if (similar.length > 0) {
        const groupContacts = [pi.contact, ...similar];
        const infoScores = groupContacts.map((c: { id: string; name: string; phone: string | null; wechat: string | null; memo: string | null }) =>
          this.computeInfoScore(c, followupCountMap, tagCountMap)
        );
        nameSimilarityGroups.push({
          groupKey: `name-${nameSimilarityGroups.length}`,
          type: 'suspected' as const,
          matchField: 'name' as const,
          matchValue: pi.contact.name,
          dedupType: 'name' as const,
          contacts: groupContacts.map((c: { id: string; name: string; phone: string | null; wechat: string | null; memo: string | null }, k: number) => ({
            id: c.id,
            name: c.name,
            phone: c.phone ?? undefined,
            wechat: c.wechat ?? undefined,
            memo: c.memo ?? undefined,
            followupCount: followupCountMap.get(c.id) ?? 0,
            tagCount: tagCountMap.get(c.id) ?? 0,
            infoScore: infoScores[k],
          })),
        });
        for (const c of groupContacts) usedInNameGroup.add(c.id);
      }
    }

    const allGroups = [...exactGroups, ...nameSimilarityGroups];
    const totalDuplicateContacts = allGroups.reduce(
      (sum: number, g: { contacts: Array<{ id: string }> }) => sum + g.contacts.length,
      0
    );

    return {
      groups: allGroups,
      totalExactGroups: exactGroups.length,
      totalSuspectedGroups: nameSimilarityGroups.length,
      totalDuplicateContacts: totalDuplicateContacts,
    };
  }

  async executeDedup(body: DedupExecuteRequest): Promise<DedupExecuteResponse> {
    if (!body.groups || body.groups.length === 0) {
      throw new BadRequestException('No dedup groups provided');
    }

    const userId = UserContext.getUserId();
    const result = await this.db.transaction(async (tx) => {
      let mergedGroups = 0;
      let deletedContacts = 0;
      let mergedFollowups = 0;
      let mergedTags = 0;

      for (const group of body.groups) {
        const { keepId, mergeIds } = group;
        if (mergeIds.length === 0) continue;

        // 越权防线：keepId 必须属于当前用户
        const [keepOwned] = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.id, keepId), eq(contacts.userId, userId)))
          .limit(1);
        if (!keepOwned) continue;

        // Merge followups: reassign to keepId, skip duplicates (same content + date)
        const existingFollowups = await tx
          .select({ content: followups.content, date: followups.followupDate })
          .from(followups)
          .where(and(eq(followups.contactId, keepId), eq(followups.userId, userId)));
        const existingKeys = new Set(existingFollowups.map((f: { content: string; date: string }) => `${f.content}::${f.date}`));

        const mergeFollowups = await tx
          .select()
          .from(followups)
          .where(and(inArray(followups.contactId, mergeIds), eq(followups.userId, userId)));

        const newFollowups: Array<typeof followups.$inferInsert> = [];
        for (const f of mergeFollowups) {
          const key = `${f.content}::${f.followupDate}`;
          if (!existingKeys.has(key)) {
            existingKeys.add(key);
            newFollowups.push({
              userId,
              contactId: keepId,
              content: f.content,
              followupType: f.followupType,
              followupDate: f.followupDate,
              nextFollowupDate: f.nextFollowupDate,
            });
          }
        }

        let groupFollowupCount = 0;
        if (newFollowups.length > 0) {
          await tx.insert(followups).values(newFollowups);
          mergedFollowups += newFollowups.length;
          groupFollowupCount = newFollowups.length;
        }

        // Merge tags: add tags from mergeIds to keepId (仅合并属于当前用户的标签)
        const mergeTagRows = await tx
          .select({ tagId: contactTags.tagId })
          .from(contactTags)
          .innerJoin(tags, eq(contactTags.tagId, tags.id))
          .where(and(inArray(contactTags.contactId, mergeIds), eq(tags.userId, userId)));
        const existingTagRows = await tx
          .select({ tagId: contactTags.tagId })
          .from(contactTags)
          .where(eq(contactTags.contactId, keepId));
        const existingTagIds = new Set(existingTagRows.map((t: { tagId: string }) => t.tagId));

        const newTagRelations: Array<typeof contactTags.$inferInsert> = [];
        for (const t of mergeTagRows) {
          if (!existingTagIds.has(t.tagId)) {
            existingTagIds.add(t.tagId);
            newTagRelations.push({ contactId: keepId, tagId: t.tagId });
          }
        }

        let groupTagCount = 0;
        if (newTagRelations.length > 0) {
          await tx.insert(contactTags).values(newTagRelations).onConflictDoNothing();
          groupTagCount = newTagRelations.length;
          mergedTags += groupTagCount;
        }

        // Get merged contact names before deleting（仅当前用户的联系人）
        const mergedContactRows = await tx
          .select({ id: contacts.id, name: contacts.name })
          .from(contacts)
          .where(and(inArray(contacts.id, mergeIds), eq(contacts.userId, userId)));
        const mergedContactNames = mergedContactRows.map((r: { id: string; name: string }) => r.name);

        // Delete merged contacts (followups + contactTags cascade via FK)
        const deleted = await tx.delete(contacts)
          .where(and(inArray(contacts.id, mergedContactRows.map((r) => r.id)), eq(contacts.archived, false), eq(contacts.userId, userId)))
          .returning({ id: contacts.id });

        deletedContacts += deleted.length;
        mergedGroups += 1;

        // Get keep contact name
        const keepRows = await tx
          .select({ name: contacts.name })
          .from(contacts)
          .where(eq(contacts.id, keepId))
          .limit(1);
        const keepContactName = keepRows[0]?.name ?? '';

        // Insert merge log
        await tx.insert(mergeLogs).values({
          userId,
          keepContactId: keepId,
          keepContactName,
          mergedContactIds: mergeIds,
          mergedContactNames,
          mergedPhone: group.phone ?? null,
          mergedFollowups: groupFollowupCount,
          mergedTags: groupTagCount,
          similarityType: group.similarityType ?? 'phone',
        });
      }

      return { mergedGroups, deletedContacts, mergedFollowups, mergedTags };
    });

    return result;
  }

  // ========== Merge Logs ==========

  async getMergeLogs(
    rawPage: number,
    rawPageSize: number,
    contactId?: string,
  ): Promise<MergeLogListResponse> {
    // 分页钳制：page≥1，pageSize 限制在 1~100，防止越界拉全表
    const page = rawPage && rawPage > 0 ? rawPage : 1;
    const pageSize =
      rawPageSize && rawPageSize > 0 ? Math.min(rawPageSize, 100) : 20;
    const offset = (page - 1) * pageSize;
    const uid = UserContext.getUserId();

    let whereClause = eq(mergeLogs.userId, uid);
    if (contactId) {
      whereClause = and(
        whereClause,
        or(
          eq(mergeLogs.keepContactId, contactId),
          sql`${contactId} = ANY(${mergeLogs.mergedContactIds})`
        ),
      );
    }

    const [rows, totalResult] = await Promise.all([
      this.db
        .select()
        .from(mergeLogs)
        .where(whereClause)
        .orderBy(desc(mergeLogs.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ count: count() }).from(mergeLogs).where(whereClause),
    ]);

    type MergeLogRow = typeof mergeLogs.$inferSelect;
    const items: MergeLog[] = rows.map((row: MergeLogRow) => ({
      id: row.id,
      keepContactId: row.keepContactId,
      keepContactName: row.keepContactName,
      mergedContactIds: row.mergedContactIds as string[],
      mergedContactNames: row.mergedContactNames as string[],
      mergedPhone: row.mergedPhone ?? undefined,
      mergedFollowups: row.mergedFollowups,
      mergedTags: row.mergedTags,
      similarityType: (row.similarityType as 'phone' | 'name') ?? 'phone',
      createdAt: row.createdAt.toISOString(),
    }));

    return {
      items,
      total: Number(totalResult[0]?.count ?? 0),
    };
  }

  // ========== Phone Normalization ==========

  async normalizePhones(): Promise<PhoneNormalizeResult> {
    const uid = UserContext.getUserId();
    const allWithPhone = await this.db
      .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
      .from(contacts)
      .where(and(eq(contacts.archived, false), isNotNull(contacts.phone), eq(contacts.userId, uid)));

    const toUpdate: Array<{ id: string; phone: string }> = [];
    const invalidList: Array<{ id: string; name: string; phone: string }> = [];

    const isValidPhone = (p: string): boolean => /^1\d{10}$/.test(p);

    const normalizePhone = (raw: string): string => {
      let p = raw.trim();
      p = p.replace(/\s+/g, '');
      p = p.replace(/-/g, '');
      if (p.startsWith('+86')) p = p.slice(3);
      if (p.startsWith('86') && p.length === 13) p = p.slice(2);
      return p;
    };

    for (const c of allWithPhone) {
      const rawPhone = c.phone as string;
      if (isValidPhone(rawPhone)) continue; // already standard
      const normalized = normalizePhone(rawPhone);
      if (isValidPhone(normalized)) {
        toUpdate.push({ id: c.id, phone: normalized });
      } else {
        invalidList.push({ id: c.id, name: c.name, phone: rawPhone });
      }
    }

    // Also check contacts that remain invalid after normalization
    // plus contacts already non-standard but we couldn't fix
    if (toUpdate.length > 0) {
      const now = new Date();
      await this.db.transaction(async (tx) => {
        for (const item of toUpdate) {
          await tx.update(contacts)
            .set({ phone: item.phone, updatedAt: now })
            .where(and(eq(contacts.id, item.id), eq(contacts.userId, uid)));
        }
      });
    }

    // Count remaining invalid phones after update (all contacts with non-standard phone)
    const remainingInvalid = await this.db
      .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
      .from(contacts)
      .where(and(eq(contacts.archived, false), isNotNull(contacts.phone), sql`${contacts.phone} !~ '^1\\d{10}$'`, eq(contacts.userId, uid)));

    return {
      updated: toUpdate.length,
      invalidCount: remainingInvalid.length,
      invalidContacts: remainingInvalid.map((c: { id: string; name: string; phone: string | null }) => ({
        id: c.id,
        name: c.name,
        phone: c.phone ?? '',
      })),
    };
  }

  // ========== Tier Suggestions ==========

  async getTierSuggestions(): Promise<TierSuggestionResponse> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    // Get all non-archived contacts with tier info（仅当前用户）
    const allContacts = await this.db
      .select({ id: contacts.id, name: contacts.name, phone: contacts.phone, tier: contacts.tier })
      .from(contacts)
      .where(and(eq(contacts.archived, false), eq(contacts.userId, UserContext.getUserId())));

    if (allContacts.length === 0) {
      return { suggestions: [], total: 0 };
    }

    const contactIds = allContacts.map((c: { id: string; name: string; phone: string | null; tier: string | null }) => c.id);

    // Get followup counts per contact in last 30 days
    const followup30d = await this.db
      .select({ contactId: followups.contactId, cnt: count() })
      .from(followups)
      .where(and(inArray(followups.contactId, contactIds), gte(followups.followupDate, thirtyDaysAgo.toISOString().slice(0, 10))))
      .groupBy(followups.contactId);
    const count30dMap = new Map<string, number>();
    for (const f of followup30d) {
      count30dMap.set(f.contactId, Number(f.cnt));
    }

    // Get latest followup date per contact
    const latestFollowups = await this.db
      .select({ contactId: followups.contactId, lastDate: sql<string>`MAX(${followups.followupDate})` })
      .from(followups)
      .where(inArray(followups.contactId, contactIds))
      .groupBy(followups.contactId);
    const lastFollowupMap = new Map<string, string>();
    for (const f of latestFollowups) {
      lastFollowupMap.set(f.contactId, String(f.lastDate));
    }

    const tierOrder: ContactTier[] = ['S', 'A', 'B', 'C', 'D', 'V'];
    const tierUp = (t: ContactTier): ContactTier | null => {
      const idx = tierOrder.indexOf(t);
      if (idx <= 0) return null; // S can't go up
      return tierOrder[idx - 1];
    };
    const tierDown = (t: ContactTier): ContactTier | null => {
      const idx = tierOrder.indexOf(t);
      if (idx === -1 || idx >= tierOrder.length - 1) return null; // D/V can't go down further
      // D is at index 4, V at 5. D should not go down (D->V is not a normal demotion)
      if (t === 'D') return null;
      return tierOrder[idx + 1];
    };

    const suggestions: TierSuggestion[] = [];

    for (const c of allContacts) {
      const currentTier = (c.tier as ContactTier) ?? 'C';
      const count30d = count30dMap.get(c.id) ?? 0;
      const lastFollowup = lastFollowupMap.get(c.id);

      // Rule 1: 3+ followups in 30 days → upgrade
      if (count30d >= 3) {
        const suggested = tierUp(currentTier);
        if (suggested) {
          suggestions.push({
            id: c.id,
            name: c.name,
            phone: c.phone ?? undefined,
            currentTier,
            suggestedTier: suggested,
            reason: `近30天有${count30d}次跟进，建议升一级`,
            followupCount: count30d,
            lastFollowupDate: lastFollowup,
          });
          continue;
        }
      }

      // Rule 2: no followup in 90 days → downgrade
      if (!lastFollowup || lastFollowup < ninetyDaysAgo.toISOString().slice(0, 10)) {
        const suggested = tierDown(currentTier);
        if (suggested) {
          suggestions.push({
            id: c.id,
            name: c.name,
            phone: c.phone ?? undefined,
            currentTier,
            suggestedTier: suggested,
            reason: lastFollowup ? `最近跟进在${lastFollowup}，超过90天无跟进，建议降一级` : '无跟进记录，建议降一级',
            followupCount: count30d,
            lastFollowupDate: lastFollowup,
          });
        }
      }
    }

    // Sort by reason type and limit to 50
    suggestions.sort((a: TierSuggestion, b: TierSuggestion) => {
      if (a.suggestedTier < b.suggestedTier) return -1; // upgrade first
      if (a.suggestedTier > b.suggestedTier) return 1;
      return b.followupCount - a.followupCount;
    });

    const total = suggestions.length;
    const limited = suggestions.slice(0, 50);

    return { suggestions: limited, total };
  }

  async applyTierSuggestions(body: TierSuggestionApplyRequest): Promise<{ updated: number }> {
    if (!body.contactIds || body.contactIds.length === 0) {
      return { updated: 0 };
    }

    // First get all suggestions (recompute to be safe)
    const { suggestions } = await this.getTierSuggestions();
    const suggestionMap = new Map<string, ContactTier>();
    for (const s of suggestions) {
      suggestionMap.set(s.id, s.suggestedTier);
    }

    const toUpdate: string[] = [];
    for (const id of body.contactIds) {
      if (suggestionMap.has(id)) {
        toUpdate.push(id);
      }
    }

    if (toUpdate.length === 0) {
      return { updated: 0 };
    }

    const now = new Date();
    const uid = UserContext.getUserId();
    const result = await this.db.transaction(async (tx) => {
      let count = 0;
      for (const id of toUpdate) {
        const suggestedTier = suggestionMap.get(id) as ContactTier;
        const updated = await tx.update(contacts)
          .set({ tier: suggestedTier, updatedAt: now })
          .where(and(eq(contacts.id, id), eq(contacts.userId, uid)))
          .returning({ id: contacts.id });
        if (updated.length > 0) count += 1;
      }
      return count;
    });

    return { updated: result };
  }

  // ========== Nickname Clean ==========

  private applyNicknameOperation(
    current: string,
    op: NicknameCleanOperation,
    contactTier: string | null,
    contactName: string,
    contactPhone: string | null,
  ): string {
    switch (op.type) {
      case 'removeSpecialChars': {
        // Remove special characters: commas, %, 、, extra spaces, etc.
        let result = current;
        result = result.replace(/[，%、,·\.。\!！\?？~～\-—_]/g, ' ');
        result = result.replace(/\s+/g, ' ').trim();
        return result;
      }
      case 'searchReplace': {
        if (!op.from) return current;
        return current.split(op.from).join(op.to ?? '');
      }
      case 'addPrefix': {
        const tier = contactTier ?? 'C';
        const sep = op.separator ?? '·';
        return `${tier}${sep}${current}`;
      }
      case 'generateFromNamePhone': {
        const tier = contactTier ?? 'C';
        const sep = op.separator ?? '·';
        const phone = contactPhone ?? '';
        const last4 = phone.length >= 4 ? phone.slice(-4) : '';
        if (last4) {
          return `${tier}${sep}${contactName}（${last4}）`;
        }
        return `${tier}${sep}${contactName}`;
      }
      case 'normalizeHistoryPrefix': {
        const trimmed = current.trim();
        const tierLetters = ['S', 'A', 'B', 'C', 'D', 'V'];
        const sep = op.separator ?? '·';

        // Match letter prefix: A/a/B/b etc. followed by 、.·, or space
        const letterMatch = trimmed.match(/^([sSaAbBcCdDvV])([\s、\.·,，．]+)(.+)$/);
        if (letterMatch) {
          const letter = letterMatch[1].toUpperCase();
          const rest = letterMatch[3].trim();
          if (tierLetters.includes(letter) && rest) {
            return `${letter}${sep}${rest}`;
          }
        }

        // Match numeric prefix: 0. 1. 0 1 etc. → remove prefix, no tier
        const numMatch = trimmed.match(/^\d+([\s、\.·,，．]+)(.+)$/);
        if (numMatch) {
          return numMatch[2].trim();
        }

        // Unrecognized prefix → keep original
        return current;
      }
      default:
        return current;
    }
  }

  async getNicknameCleanPreview(body: NicknameCleanPreviewRequest): Promise<NicknameCleanPreviewResponse> {
    if (!body.operations || body.operations.length === 0) {
      throw new BadRequestException('No operations provided');
    }

    const baseConditions = [eq(contacts.archived, false), eq(contacts.userId, UserContext.getUserId())];
    if (body.contactIds && body.contactIds.length > 0) {
      baseConditions.push(inArray(contacts.id, body.contactIds));
    }

    const contactRows = await this.db
      .select({ id: contacts.id, name: contacts.name, nickname: contacts.nickname, tier: contacts.tier, phone: contacts.phone })
      .from(contacts)
      .where(and(...baseConditions));

    const items = [];
    for (const c of contactRows) {
      // Use nickname as base, fallback to name
      const oldName = c.nickname || c.name;
      let newName = oldName;

      for (const op of body.operations) {
        newName = this.applyNicknameOperation(
          newName,
          op,
          c.tier,
          c.name,
          c.phone,
        );
      }

      items.push({
        contactId: c.id,
        oldName,
        newName,
      });
    }

    return { items, total: items.length };
  }

  async executeNicknameClean(body: NicknameCleanExecuteRequest): Promise<NicknameCleanExecuteResponse> {
    if (!body.items || body.items.length === 0) {
      return { updated: 0, backup: [] };
    }

    const contactIds = body.items.map((item) => item.contactId);

    const result = await this.db.transaction(async (tx) => {
      // Read current nicknames for backup（仅当前用户的联系人）
      const uid = UserContext.getUserId();
      const currentRows = await tx
        .select({ id: contacts.id, nickname: contacts.nickname })
        .from(contacts)
        .where(and(inArray(contacts.id, contactIds), eq(contacts.userId, uid)));

      const backup = currentRows.map((row: { id: string; nickname: string | null }) => ({
        id: row.id,
        nickname: row.nickname,
      }));

      // Update each contact
      const now = new Date();
      let updated = 0;
      for (const item of body.items) {
        const res = await tx.update(contacts)
          .set({ nickname: item.newName, updatedAt: now })
          .where(and(eq(contacts.id, item.contactId), eq(contacts.userId, uid)))
          .returning({ id: contacts.id });
        if (res.length > 0) updated += 1;
      }

      return { updated, backup };
    });

    return result;
  }

  // ========== XLSX Import ==========

  private mapColumnToField(columnName: string): { field: string; type: 'direct' | 'memo' | 'source' | 'tier' } | null {
    const name = columnName.trim().toLowerCase();

    if (/^(姓名|名字|名称|客户姓名|联系人|name)$/i.test(columnName.trim())) return { field: 'name', type: 'direct' };
    if (/^(昵称|备注名|别名|nickname|nick)$/i.test(columnName.trim())) return { field: 'nickname', type: 'direct' };
    if (/^(手机|手机号|电话|联系电话|联系方式|号码|phone|mobile|tel|联系手机)$/i.test(columnName.trim())) return { field: 'phone', type: 'direct' };
    if (/^(微信|微信号|wx|wechat|微信id)$/i.test(columnName.trim())) return { field: 'wechat', type: 'direct' };
    if (/^(关系|关系类型|relationship|relation)$/i.test(columnName.trim())) return { field: 'relationship', type: 'direct' };
    if (/^(公司|单位|企业|company|org|organization)$/i.test(columnName.trim())) return { field: 'company', type: 'direct' };
    if (/^(职位|职务|title|position|job)$/i.test(columnName.trim())) return { field: 'position', type: 'direct' };
    if (/^(来源|渠道|source)$/i.test(columnName.trim())) return { field: 'source', type: 'source' };
    if (/^(意向|意向等级|等级|级别|客户等级|层级|tier|level)$/i.test(columnName.trim())) return { field: 'tier', type: 'tier' };
    if (/^(下次跟进|跟进时间|下次联系|next_followup|followup_date)$/i.test(columnName.trim())) return { field: 'nextFollowupDate', type: 'direct' };
    if (/^(区域|意向区域|地段|area|region)$/i.test(columnName.trim())) return { field: 'area', type: 'memo' };
    if (/^(楼盘|小区|社区|楼盘名称|property|community)$/i.test(columnName.trim())) return { field: 'memo', type: 'memo' };
    if (/^(预算|价格|总价|budget|price)$/i.test(columnName.trim())) return { field: 'budget', type: 'memo' };
    if (/^(房型|户型|house_type|layout)$/i.test(columnName.trim())) return { field: 'houseType', type: 'memo' };
    if (/^(备注|说明|备注名|备注信息|remark|note|memo)$/i.test(columnName.trim())) return { field: 'remark', type: 'memo' };

    return null;
  }

  private mapTierValue(raw: string): string | null {
    const v = raw.trim();
    if (/^(高|高意向|强烈意向|A)$/i.test(v)) return 'A';
    if (/^(中|中意向|一般意向|B)$/i.test(v)) return 'B';
    if (/^(低|低意向|弱意向|C)$/i.test(v)) return 'C';
    if (/^(成交|已成交|签约|S)$/i.test(v)) return 'S';
    if (/^(不考虑|无意向|放弃|D)$/i.test(v)) return 'D';
    // App 端 U（未拨打/未分类）等未分层值 → D（线索客户），保证分层看板可见
    if (/^(U|未|未分类|未知|待定|无)$/i.test(v)) return 'D';
    return null;
  }

  private normalizePhone(raw: string): string {
    let p = raw.trim();
    p = p.replace(/\s+/g, '');
    p = p.replace(/-/g, '');
    if (p.startsWith('+86')) p = p.slice(3);
    if (p.startsWith('86') && p.length === 13) p = p.slice(2);
    return p;
  }

  private parseDateStr(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // Try common formats: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
    const m = trimmed.match(/^(\d{4})[-./年](\d{1,2})[-./月](\d{1,2})/);
    if (m) {
      const y = m[1];
      const mo = m[2].padStart(2, '0');
      const d = m[3].padStart(2, '0');
      return `${y}-${mo}-${d}`;
    }
    // If already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    return null;
  }

  async importXlsx(body: XlsxImportRequest): Promise<XlsxImportResponse> {
    const { rows, mode, duplicateStrategy, batchName } = body;

    if (!rows || rows.length === 0) {
      return { success: true, imported: 0, skipped: 0, failed: 0, total: 0, errors: ['无导入数据'] };
    }

    // Parse rows into contact-like structures
    const parsedRows: Array<{
      name: string;
      phone: string;
      wechat?: string;
      nickname?: string;
      relationshipType?: string;
      source?: string;
      tier: string;
      memo: string;
      nextFollowupDate?: string;
      sourceTag?: string;
      errors: string[];
    }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const parsed = {
        name: '',
        phone: '',
        wechat: '',
        nickname: '' as string | undefined,
        relationshipType: '' as string | undefined,
        source: '' as string | undefined,
        tier: 'C',
        memo: '',
        nextFollowupDate: undefined as string | undefined,
        sourceTag: undefined as string | undefined,
        errors: [] as string[],
      };

      const memoParts: string[] = [];

      for (const [colName, value] of Object.entries(row)) {
        if (!value || !value.trim()) continue;
        const mapping = this.mapColumnToField(colName);
        if (!mapping) continue;

          switch (mapping.type) {
            case 'direct':
              if (mapping.field === 'name') parsed.name = value.trim();
              else if (mapping.field === 'nickname') parsed.nickname = value.trim();
              else if (mapping.field === 'phone') parsed.phone = this.normalizePhone(value);
              else if (mapping.field === 'wechat') parsed.wechat = value.trim();
              else if (mapping.field === 'relationship') parsed.relationshipType = value.trim();
              else if (mapping.field === 'company') parsed.sourceTag = value.trim();
              else if (mapping.field === 'position') {
                memoParts.push(`职务：${value.trim()}`);
              } else if (mapping.field === 'nextFollowupDate') {
                const d = this.parseDateStr(value);
                if (d) parsed.nextFollowupDate = d;
              }
              break;
          case 'tier': {
            const t = this.mapTierValue(value);
            if (t) parsed.tier = t;
            break;
          }
          case 'source':
            parsed.sourceTag = value.trim();
            break;
          case 'memo':
            memoParts.push(`${colName.trim()}：${value.trim()}`);
            break;
        }
      }

      if (memoParts.length > 0) {
        parsed.memo = memoParts.join('；');
      }

      // 智能回填：如果phone为空且name里含有11位手机号，则抽取作为phone
      if (!parsed.phone && parsed.name) {
        const phoneMatch = parsed.name.match(/(?<!\d)1[3-9]\d{9}(?!\d)/);
        if (phoneMatch) {
          parsed.phone = phoneMatch[0];
        }
      }

      // 空行过滤：name 和 phone 都为空的行直接跳过，不算失败
      if (!parsed.name && !parsed.phone) {
        continue;
      }

      if (!parsed.name) {
        parsed.errors.push(`第${i + 1}行：缺少姓名`);
      }

      parsedRows.push(parsed);
    }

    const validRows = parsedRows.filter((r) => r.errors.length === 0);
    const failedCount = parsedRows.length - validRows.length;
    const errors = parsedRows.flatMap((r) => r.errors);

    // 批次内去重：同一手机号（已标准化）的多条记录只保留第一条，避免同批次内重复导入
    const seenPhones = new Set<string>();
    const dedupedRows: typeof validRows = [];
    let batchDupSkipped = 0;
    for (const row of validRows) {
      if (row.phone) {
        if (seenPhones.has(row.phone)) {
          batchDupSkipped += 1;
          continue;
        }
        seenPhones.add(row.phone);
      }
      dedupedRows.push(row);
    }

    const userId = UserContext.getUserId();
    const result = await this.db.transaction(async (tx) => {
      let imported = 0;
      let skipped = batchDupSkipped;

      // overwrite mode: 清当前用户的 contacts, tags, relations, followups, messages,
      // 以及追溯层（import_batches / operation_logs），避免批次卡片残留旧数据。
      if (mode === 'overwrite') {
        await tx.delete(followups).where(eq(followups.userId, userId));
        await tx.delete(messages).where(eq(messages.userId, userId));
        await tx.delete(contactTags).where(sql`${contactTags.contactId} IN (SELECT id FROM contacts WHERE user_id = ${userId})`);
        await tx.delete(contacts).where(eq(contacts.userId, userId));
        await tx.delete(tags).where(eq(tags.userId, userId));
        await tx.delete(operationLogs).where(eq(operationLogs.userId, userId));
        await tx.delete(importBatches).where(eq(importBatches.userId, userId));
      }

      // Create batch record
      const batchRecord = await tx.insert(importBatches).values({
        userId,
        name: batchName?.trim() || 'XLSX导入',
        source: 'xlsx',
        contactCount: 0,
      }).returning({ id: importBatches.id, name: importBatches.name, source: importBatches.source, contactCount: importBatches.contactCount, createdAt: importBatches.createdAt });

      const batchId = batchRecord[0].id;

      // Collect unique phones for dedup lookup
      const phonesWithData = dedupedRows.filter((r) => r.phone);
      const uniquePhones = [...new Set(phonesWithData.map((r) => r.phone))];

      // Existing contacts by phone (for dedup)
      const existingMap = new Map<string, string>(); // phone -> contactId
      if (duplicateStrategy === 'skip' || duplicateStrategy === 'update') {
        if (uniquePhones.length > 0) {
          const existing = await tx
            .select({ id: contacts.id, phone: contacts.phone })
            .from(contacts)
            .where(and(inArray(contacts.phone, uniquePhones), eq(contacts.userId, userId)));
          for (const c of existing) {
            if (c.phone) existingMap.set(c.phone, c.id);
          }
        }
      }

      // Ensure source tags exist
      const sourceTagNames = [...new Set(dedupedRows.filter((r) => r.sourceTag).map((r) => r.sourceTag as string))];
      const sourceTagIdMap = new Map<string, string>();
      if (sourceTagNames.length > 0) {
        const existingTags = await tx
          .select({ id: tags.id, name: tags.name })
          .from(tags)
          .where(and(inArray(tags.name, sourceTagNames), eq(tags.userId, userId)));
        for (const t of existingTags) {
          sourceTagIdMap.set(t.name, t.id);
        }
        const missingTags = sourceTagNames.filter((n) => !sourceTagIdMap.has(n));
        if (missingTags.length > 0) {
          const newTags = await tx
            .insert(tags)
            .values(missingTags.map((name) => ({
              userId,
              name,
              category: 'attribute',
              color: '#64748b',
              sortOrder: 0,
            })))
            .returning({ id: tags.id, name: tags.name });
          for (const t of newTags) {
            sourceTagIdMap.set(t.name, t.id);
          }
        }
      }

      // Insert or update contacts
      const newContactTags: Array<{ contactId: string; tagId: string }> = [];

      for (const row of dedupedRows) {
        // Dedup by phone
        if (row.phone && existingMap.has(row.phone)) {
          if (duplicateStrategy === 'skip') {
            skipped += 1;
            continue;
          }
          if (duplicateStrategy === 'update') {
            const contactId = existingMap.get(row.phone) as string;
            const patch: Partial<typeof contacts.$inferInsert> = {};
            if (row.name) patch.name = row.name;
            if (row.wechat) patch.wechat = row.wechat;
            if (row.tier) patch.tier = row.tier;
            if (row.memo) patch.memo = row.memo;
            if (row.nextFollowupDate) patch.nextFollowupDate = row.nextFollowupDate;
            if (Object.keys(patch).length > 0) {
              patch.updatedAt = new Date();
              await tx.update(contacts).set(patch).where(and(eq(contacts.id, contactId), eq(contacts.userId, userId)));
            }
            // Add source tag if present
            if (row.sourceTag) {
              const tagId = sourceTagIdMap.get(row.sourceTag);
              if (tagId) newContactTags.push({ contactId, tagId });
            }
            imported += 1;
            continue;
          }
        }

        // New contact
        const newContacts = await tx.insert(contacts).values({
          userId,
          name: row.name,
          nickname: (row as { nickname?: string }).nickname || null,
          phone: row.phone || null,
          wechat: row.wechat || null,
          tier: row.tier,
          relationshipType: (row as { relationshipType?: string }).relationshipType || null,
          memo: row.memo || null,
          nextFollowupDate: row.nextFollowupDate ?? null,
          batchId,
          archived: false,
        }).returning({ id: contacts.id });

        const contactId = newContacts[0].id;
        if (row.sourceTag) {
          const tagId = sourceTagIdMap.get(row.sourceTag);
          if (tagId) newContactTags.push({ contactId, tagId });
        }
        imported += 1;
      }

      // Insert contact-tag relations (ON CONFLICT DO NOTHING)
      if (newContactTags.length > 0) {
        await tx.insert(contactTags).values(newContactTags).onConflictDoNothing();
      }

      // Update batch contact count
      await tx.update(importBatches)
        .set({ contactCount: imported, updatedAt: new Date() })
        .where(eq(importBatches.id, batchId));

      const batchRow = batchRecord[0];
      const batch: ImportBatch = {
        id: batchRow.id,
        name: batchRow.name,
        source: batchRow.source ?? undefined,
        contactCount: imported,
        createdAt: batchRow.createdAt.toISOString(),
      };

      return { imported, skipped, batch };
    });

    return {
      success: true,
      batch: result.batch,
      imported: result.imported,
      skipped: result.skipped,
      failed: failedCount,
      total: rows.length,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // ========== Seed Examples ==========

  async seedExamples(): Promise<{ success: boolean; count: number; batchId: string }> {
    // Check if there are already contacts（按当前用户判断）
    const userId = UserContext.getUserId();
    const [{ cnt }] = await this.db.select({ cnt: count() }).from(contacts).where(eq(contacts.userId, userId));
    const total = Number(cnt ?? 0);
    if (total > 0) {
      return { success: false, count: 0, batchId: '' };
    }

    const result = await this.db.transaction(async (tx) => {
      // Create batch
      const batchRows = await tx.insert(importBatches).values({
        userId,
        name: '示例数据',
        source: 'seed',
        contactCount: 18,
      }).returning({ id: importBatches.id });
      const batchId = batchRows[0].id;

      // Create preset tags
      const presetTags: Array<{ name: string; category: string; color: string; sortOrder: number }> = [
        { name: '成交客户', category: 'identity', color: '#dc2626', sortOrder: 1 },
        { name: '买房客户', category: 'identity', color: '#2563eb', sortOrder: 2 },
        { name: '业主', category: 'identity', color: '#16a34a', sortOrder: 3 },
        { name: '投资', category: 'attribute', color: '#9333ea', sortOrder: 1 },
        { name: '学区房', category: 'attribute', color: '#ea580c', sortOrder: 2 },
        { name: '地铁房', category: 'attribute', color: '#0891b2', sortOrder: 3 },
        { name: '改善型', category: 'attribute', color: '#4f46e5', sortOrder: 4 },
        { name: '刚需', category: 'attribute', color: '#059669', sortOrder: 5 },
        { name: '公寓', category: 'attribute', color: '#be185d', sortOrder: 6 },
        { name: '同行', category: 'identity', color: '#6b7280', sortOrder: 4 },
        { name: '线索', category: 'identity', color: '#9ca3af', sortOrder: 5 },
        { name: '卖房', category: 'attribute', color: '#dc2626', sortOrder: 7 },
      ];

      const tagRows = await tx.insert(tags).values(presetTags.map((t) => ({ ...t, userId }))).returning({ id: tags.id, name: tags.name });
      const tagIdMap = new Map<string, string>();
      for (const t of tagRows) {
        tagIdMap.set(t.name, t.id);
      }

      // 18 sample contacts
      const sampleContacts: Array<{
        name: string;
        phone: string;
        wechat: string;
        tier: ContactTier;
        memo?: string;
        nextFollowupDate?: string;
        followupNote?: string;
        tagNames: string[];
      }> = [
        // S级 (2)
        {
          name: '陈建国', phone: '13800000001', wechat: 'chenjianguo888', tier: 'S',
          memo: '融创玖玺台3栋2501，成交价380万',
          nextFollowupDate: '2026-10-15', followupNote: '老客户回访送礼品',
          tagNames: ['成交客户', '业主'],
        },
        {
          name: '王美华', phone: '13900000002', wechat: 'wangmeihua', tier: 'S',
          memo: '中海紫御公馆两居，成交价268万，学区用',
          nextFollowupDate: '2026-10-10',
          tagNames: ['成交客户', '买房客户'],
        },
        // A级 (4)
        {
          name: '张哥', phone: '13800000003', wechat: 'zhangge_666', tier: 'A',
          memo: '想看三小学区的三居，预算350万左右，优先融创片区',
          nextFollowupDate: '2026-09-30',
          tagNames: ['买房客户', '改善型', '学区房'],
        },
        {
          name: '李姐', phone: '13900000004', wechat: 'lijie_88', tier: 'A',
          memo: '首套刚需，预算200万以内，地铁1号线沿线',
          nextFollowupDate: '2026-09-28',
          tagNames: ['买房客户', '刚需', '地铁房'],
        },
        {
          name: '刘总', phone: '13700000005', wechat: 'liuzong_business', tier: 'A',
          memo: '投资用途，关注核心地段公寓和商铺，预算500万',
          nextFollowupDate: '2026-10-05',
          tagNames: ['投资', '业主'],
        },
        {
          name: '赵姐', phone: '13600000006', wechat: 'zhaojie_006', tier: 'A',
          memo: '万科翡翠公园三居想卖，报价320万，可谈',
          nextFollowupDate: '2026-09-29',
          tagNames: ['业主', '卖房'],
        },
        // B级 (5)
        {
          name: '孙先生', phone: '13500000007', wechat: 'sun2026', tier: 'B',
          memo: '改善换房，看中了几个盘还在比较',
          nextFollowupDate: '2026-10-08',
          tagNames: ['买房客户', '改善型'],
        },
        {
          name: '周女士', phone: '13500000008', wechat: 'zhou_ls', tier: 'B',
          memo: '为孩子上学看房，三小/一小学区',
          nextFollowupDate: '2026-10-12',
          tagNames: ['买房客户', '学区房'],
        },
        {
          name: '吴哥', phone: '13500000009', wechat: 'wu_999', tier: 'B',
          memo: '老房子想置换，先卖后买，价格合适就出手',
          nextFollowupDate: '2026-10-01',
          tagNames: ['业主', '卖房'],
        },
        {
          name: '郑姐', phone: '13500000010', wechat: 'zhengj777', tier: 'B',
          memo: '看公寓投资，回报优先',
          nextFollowupDate: '2026-10-06',
          tagNames: ['投资', '公寓'],
        },
        {
          name: '冯先生', phone: '13500000011', wechat: 'fengsir', tier: 'B',
          memo: '刚需首套，预算有限，150万左右',
          nextFollowupDate: '2026-10-15',
          tagNames: ['买房客户', '刚需'],
        },
        // C级 (5)
        {
          name: '褚先生', phone: '13500000012', wechat: 'chu_123', tier: 'C',
          memo: '咨询过一次，意向不明确',
          tagNames: ['买房客户'],
        },
        {
          name: '卫女士', phone: '13500000013', wechat: 'wei_ls', tier: 'C',
          memo: '改善换房，但近期不着急',
          tagNames: ['买房客户', '改善型'],
        },
        {
          name: '蒋哥', phone: '13500000014', wechat: 'jiangge_14', tier: 'C',
          memo: '投资客，手里有几套房，观望中',
          tagNames: ['投资'],
        },
        {
          name: '沈姐', phone: '13500000015', wechat: 'shen_jj', tier: 'C',
          memo: '老业主，问过房价，暂不打算卖',
          tagNames: ['业主'],
        },
        {
          name: '韩先生', phone: '13500000016', wechat: 'han_16', tier: 'C',
          memo: '其他中介，交流市场信息',
          tagNames: ['同行'],
        },
        // D级 (2)
        {
          name: '杨先生', phone: '13500000017', wechat: 'yangsir_17', tier: 'D',
          memo: '网站留资，电话没打通',
          tagNames: ['线索'],
        },
        {
          name: '朱姐', phone: '13500000018', wechat: 'zhu_jj', tier: 'D',
          memo: '朋友介绍，说暂时不考虑买房',
          tagNames: ['线索'],
        },
      ];

      // Insert all contacts and collect their IDs by index
      const contactInsertValues = sampleContacts.map((c) => ({
        userId,
        name: c.name,
        phone: c.phone,
        wechat: c.wechat,
        tier: c.tier,
        memo: c.memo ?? null,
        nextFollowupDate: c.nextFollowupDate ?? null,
        followupNote: c.followupNote ?? null,
        batchId,
        archived: false,
      }));

      const insertedContacts = await tx.insert(contacts).values(contactInsertValues).returning({ id: contacts.id });

      // Build contact-tag relations
      const contactTagRelations: Array<{ contactId: string; tagId: string }> = [];
      for (let i = 0; i < sampleContacts.length; i++) {
        const contactId = insertedContacts[i].id;
        for (const tagName of sampleContacts[i].tagNames) {
          const tagId = tagIdMap.get(tagName);
          if (tagId) {
            contactTagRelations.push({ contactId, tagId });
          }
        }
      }

      if (contactTagRelations.length > 0) {
        await tx.insert(contactTags).values(contactTagRelations);
      }

      // Followup records for first 6 contacts (1-2 each)
      const followupInserts: Array<typeof followups.$inferInsert> = [
        // 陈建国 - 2条
        {
          contactId: insertedContacts[0].id,
          content: '签约完成，已交房款，客户很满意。后续帮忙介绍了同事来看房。',
          followupType: 'visit',
          followupDate: '2026-09-15',
          nextFollowupDate: '2026-10-15',
        },
        {
          contactId: insertedContacts[0].id,
          content: '电话回访入住情况，一切顺利。约好下周送乔迁礼品。',
          followupType: 'phone',
          followupDate: '2026-09-25',
        },
        // 王美华 - 2条
        {
          contactId: insertedContacts[1].id,
          content: '带看中紫御公馆两居，客户非常满意，孩子明年上小学正好。',
          followupType: 'visit',
          followupDate: '2026-09-10',
          nextFollowupDate: '2026-10-10',
        },
        {
          contactId: insertedContacts[1].id,
          content: '签约成交，价格谈到268万，客户爽快。',
          followupType: 'meeting',
          followupDate: '2026-09-20',
        },
        // 张哥 - 2条
        {
          contactId: insertedContacts[2].id,
          content: '初次沟通，改善型需求，三小学区三居，预算350万左右。',
          followupType: 'wechat',
          followupDate: '2026-09-05',
          nextFollowupDate: '2026-09-30',
        },
        {
          contactId: insertedContacts[2].id,
          content: '带看融创片区两套三居，第二套户型好但楼层偏低，再考虑。',
          followupType: 'visit',
          followupDate: '2026-09-20',
        },
        // 李姐 - 1条
        {
          contactId: insertedContacts[3].id,
          content: '首套刚需，预算200万以内，地铁1号线沿线优先。约好周末看房。',
          followupType: 'phone',
          followupDate: '2026-09-25',
          nextFollowupDate: '2026-09-28',
        },
        // 刘总 - 1条
        {
          contactId: insertedContacts[4].id,
          content: '刘总投资需求明确，核心地段公寓和商铺都看，预算充足。推荐了CBD两个项目资料。',
          followupType: 'meeting',
          followupDate: '2026-09-22',
          nextFollowupDate: '2026-10-05',
        },
        // 赵姐 - 1条
        {
          contactId: insertedContacts[5].id,
          content: '业主委托卖房，万科翡翠公园三居，120平，报价320万，心理价位310万可谈。',
          followupType: 'visit',
          followupDate: '2026-09-18',
          nextFollowupDate: '2026-09-29',
        },
      ];

      if (followupInserts.length > 0) {
        await tx.insert(followups).values(followupInserts.map((f) => ({ ...f, userId })));
      }

      return { batchId, count: sampleContacts.length };
    });

    return { success: true, count: result.count, batchId: result.batchId };
  }

  // ========== 批量操作（前端「联系人」页多选后调用）==========

  /** 批量修改层级 */
  async batchUpdateTier(body: BatchTierUpdateRequest): Promise<{ updated: number }> {
    const userId = UserContext.getUserId();
    const ids = (body.contactIds ?? []).filter(Boolean);
    if (ids.length === 0) return { updated: 0 };
    const tier = this.normalizeTierValue(body.tier);
    const updated = await this.db
      .update(contacts)
      .set({ tier, updatedAt: new Date() })
      .where(and(inArray(contacts.id, ids), eq(contacts.userId, userId)))
      .returning({ id: contacts.id });
    return { updated: updated.length };
  }

  /** 批量打标签（add 追加 / replace 覆盖） */
  async batchAddTags(body: BatchTagRequest): Promise<{ updated: number }> {
    const userId = UserContext.getUserId();
    const contactIds = (body.contactIds ?? []).filter(Boolean);
    const tagIds = (body.tagIds ?? []).filter(Boolean);
    if (contactIds.length === 0) return { updated: 0 };

    return this.db.transaction(async (tx) => {
      // 只允许操作属于当前用户的联系人
      const owned = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(inArray(contacts.id, contactIds), eq(contacts.userId, userId)));
      const ownedIds = owned.map((c) => c.id);
      if (ownedIds.length === 0) return { updated: 0 };

      // 只允许挂载属于当前用户的标签
      const ownedTags = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(and(inArray(tags.id, tagIds), eq(tags.userId, userId)));
      const ownedTagIds = ownedTags.map((t) => t.id);

      if (body.mode === 'replace') {
        await tx.delete(contactTags).where(inArray(contactTags.contactId, ownedIds));
      }
      if (ownedTagIds.length > 0) {
        const relations = ownedIds.flatMap((contactId) => ownedTagIds.map((tagId) => ({ contactId, tagId })));
        await tx.insert(contactTags).values(relations).onConflictDoNothing();
      }
      await tx.update(contacts).set({ updatedAt: new Date() }).where(inArray(contacts.id, ownedIds));
      return { updated: ownedIds.length };
    });
  }

  /** 批量删除无电话联系人 */
  async batchDeleteNoPhone(): Promise<BatchDeleteNoPhoneResponse> {
    const userId = UserContext.getUserId();
    return this.db.transaction(async (tx) => {
      const targets = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(
          eq(contacts.userId, userId),
          or(isNull(contacts.phone), eq(contacts.phone, '')),
        ));
      const ids = targets.map((t) => t.id);
      if (ids.length === 0) return { deleted: 0 };

      await tx.delete(followups).where(inArray(followups.contactId, ids));
      await tx.delete(contactTags).where(inArray(contactTags.contactId, ids));
      await tx.delete(mergeLogs).where(inArray(mergeLogs.keepContactId, ids));
      await tx.delete(contacts).where(inArray(contacts.id, ids));
      return { deleted: ids.length };
    });
  }

  // ========== 工作 APP / vCard 导入导出 ==========

  /** 工作 APP Excel 导入（列名与前端 WorkApp 模板对齐） */
  async importWorkAppExcel(body: WorkAppExcelImportRequest): Promise<ImportResult> {
    const rows = body.rows ?? [];
    if (rows.length === 0) {
      return { success: 0, skipped: 0, failed: 0, total: 0, errors: ['无导入数据'] };
    }
    return this.importRowsInternal(rows, body.mode, body.duplicateStrategy, '工作APP导入');
  }

  /** 通用联系人行导入 */
  async importContacts(body: ContactImportRequest): Promise<ImportResult> {
    const rows = body.contacts ?? [];
    if (rows.length === 0) {
      return { success: 0, skipped: 0, failed: 0, total: 0, errors: ['无导入数据'] };
    }
    return this.importRowsInternal(rows, body.mode, body.duplicateStrategy, body.source || '联系人导入');
  }

  /**
   * 行数据导入内部实现（与 importXlsx 同构，兼容任意列名）
   * 复用名称/电话/层级/标签的识别规则，保证导入结果与 Excel 路径一致。
   */
  private async importRowsInternal(
    rows: Array<Record<string, string>>,
    mode: ImportMode,
    duplicateStrategy: DuplicateStrategy,
    batchName: string,
  ): Promise<ImportResult> {
    const parseTier = (v?: string): ContactTier => this.normalizeTierValue(v);
    const pick = (row: Record<string, string>, keys: string[]): string => {
      for (const k of keys) {
        const val = row[k];
        if (val !== undefined && val !== null && String(val).trim() !== '') return String(val).trim();
      }
      return '';
    };

    const parsed: Array<{
      name: string; phone: string; wechat: string; nickname: string;
      tier: ContactTier; memo: string; nextFollowupDate: string;
      sourceTag: string; phone2: string; email: string; company: string;
      error?: string;
    }> = [];

    for (const row of rows) {
      const name = pick(row, ['姓名', '名字', 'name', '客户姓名', '联系人']);
      const phone = pick(row, ['电话', '手机', '手机号', 'phone', '联系电话', '手机号码']);
      if (!name) {
        parsed.push({ name: '', phone, wechat: '', nickname: '', tier: 'D', memo: '', nextFollowupDate: '', sourceTag: '', phone2: '', email: '', company: '', error: '缺少姓名' });
        continue;
      }
      parsed.push({
        name,
        phone,
        wechat: pick(row, ['微信', '微信号', 'wechat']),
        nickname: pick(row, ['昵称', 'nickname', '备注名']),
        tier: parseTier(pick(row, ['层级', '等级', 'tier', '意向等级', '意向'])),
        memo: pick(row, ['备注', '备注信息', 'memo', '说明', '备注说明', '楼盘', '小区', '社区']),
        nextFollowupDate: pick(row, ['下次跟进', '下次跟进日期', 'nextFollowupDate', '跟进日期']),
        sourceTag: pick(row, ['来源', '标签', 'source', '来源渠道']),
        phone2: pick(row, ['备用电话', '第二电话', 'backupPhone', '座机']),
        email: pick(row, ['邮箱', 'email', '电子邮箱']),
        company: pick(row, ['公司', '单位', 'company']),
      });
    }

    const validRows = parsed.filter((r) => !r.error);
    const failedCount = parsed.length - validRows.length;
    const errors: string[] = parsed
      .filter((r) => r.error)
      .slice(0, 20)
      .map((r, i) => `第 ${parsed.indexOf(r) + 1} 行: ${r.error}${r.name ? ` (${r.name})` : ''}`);

    // 批内手机号去重
    const seen = new Set<string>();
    const deduped: typeof validRows = [];
    let batchDupSkipped = 0;
    for (const r of validRows) {
      if (r.phone) {
        if (seen.has(r.phone)) { batchDupSkipped += 1; continue; }
        seen.add(r.phone);
      }
      deduped.push(r);
    }
    void errors;

    const userId = UserContext.getUserId();
    return this.db.transaction(async (tx) => {
      let imported = 0;
      let skipped = batchDupSkipped;

      if (mode === 'overwrite') {
        await tx.delete(followups).where(eq(followups.userId, userId));
        await tx.delete(messages).where(eq(messages.userId, userId));
        await tx.delete(contactTags).where(sql`${contactTags.contactId} IN (SELECT id FROM contacts WHERE user_id = ${userId})`);
        await tx.delete(contacts).where(eq(contacts.userId, userId));
        await tx.delete(tags).where(eq(tags.userId, userId));
        await tx.delete(operationLogs).where(eq(operationLogs.userId, userId));
        await tx.delete(importBatches).where(eq(importBatches.userId, userId));
      }

      const [batchRow] = await tx.insert(importBatches).values({
        userId,
        name: batchName,
        source: 'workapp',
        channel: 'excel_import',
        contactCount: 0,
      }).returning({ id: importBatches.id });
      const batchId = batchRow.id;

      const phones = deduped.filter((r) => r.phone).map((r) => r.phone);
      const existingMap = new Map<string, string>();
      if ((duplicateStrategy === 'skip' || duplicateStrategy === 'update') && phones.length > 0) {
        const existing = await tx
          .select({ id: contacts.id, phone: contacts.phone })
          .from(contacts)
          .where(and(inArray(contacts.phone, phones), eq(contacts.userId, userId)));
        for (const c of existing) if (c.phone) existingMap.set(c.phone, c.id);
      }

      // 来源标签自动创建
      const sourceTagNames = [...new Set(deduped.map((r) => r.sourceTag).filter(Boolean))];
      const sourceTagMap = new Map<string, string>();
      if (sourceTagNames.length > 0) {
        const existingTags = await tx.select({ id: tags.id, name: tags.name }).from(tags)
          .where(and(inArray(tags.name, sourceTagNames), eq(tags.userId, userId)));
        for (const t of existingTags) sourceTagMap.set(t.name, t.id);
        const missing = sourceTagNames.filter((n) => !sourceTagMap.has(n));
        if (missing.length > 0) {
          const created = await tx.insert(tags)
            .values(missing.map((name) => ({ userId, name, category: 'attribute', color: '#64748b', sortOrder: 0 })))
            .returning({ id: tags.id, name: tags.name });
          for (const t of created) sourceTagMap.set(t.name, t.id);
        }
      }

      const rels: Array<{ contactId: string; tagId: string }> = [];
      for (const r of deduped) {
        if (r.phone && existingMap.has(r.phone)) {
          if (duplicateStrategy === 'skip') { skipped += 1; continue; }
          const cid = existingMap.get(r.phone) as string;
          const patch: Partial<typeof contacts.$inferInsert> = { updatedAt: new Date() };
          if (r.name) patch.name = r.name;
          if (r.wechat) patch.wechat = r.wechat;
          if (r.nickname) patch.nickname = r.nickname;
          if (r.tier) patch.tier = r.tier;
          if (r.memo) patch.memo = r.memo;
          if (r.email) patch.email = r.email;
          if (r.company) patch.company = r.company;
          await tx.update(contacts).set(patch).where(and(eq(contacts.id, cid), eq(contacts.userId, userId)));
          if (r.sourceTag && sourceTagMap.get(r.sourceTag)) rels.push({ contactId: cid, tagId: sourceTagMap.get(r.sourceTag) as string });
          imported += 1;
          continue;
        }
        const [created] = await tx.insert(contacts).values({
          userId,
          name: r.name,
          phone: r.phone || null,
          wechat: r.wechat || null,
          nickname: r.nickname || null,
          tier: r.tier,
          memo: r.memo || null,
          email: r.email || null,
          company: r.company || null,
          secondPhone: r.phone2 || null,
          nextFollowupDate: r.nextFollowupDate || null,
          batchId,
        }).returning({ id: contacts.id });
        if (r.sourceTag && sourceTagMap.get(r.sourceTag)) rels.push({ contactId: created.id, tagId: sourceTagMap.get(r.sourceTag) as string });
        imported += 1;
      }

      if (rels.length > 0) await tx.insert(contactTags).values(rels).onConflictDoNothing();

      await tx.update(importBatches)
        .set({ contactCount: imported, contactCreated: imported, contactSkipped: skipped, updatedAt: new Date() })
        .where(eq(importBatches.id, batchId));

      try {
        await tx.insert(operationLogs).values({
          userId, batchId, action: 'import', channel: 'excel_import',
          summary: { batchName, total: rows.length, created: imported, skipped, failed: failedCount },
        });
      } catch { /* 流水失败不阻断导入 */ }

      return { success: imported, skipped, failed: failedCount, total: rows.length };
    });
  }

  /** 导出工作 APP Excel（CSV 兼容格式，前端负责转 xlsx） */
  async exportWorkAppCsv(): Promise<string> {
    const items = await this.loadContactsWithTags();
    const headers = ['姓名', '电话', '微信', '昵称', '层级', '来源', '备注', '下次跟进', '标签'];
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [headers.join(',')];
    for (const c of items) {
      lines.push([
        esc(c.name), esc(c.phone ?? ''), esc(c.wechat ?? ''), esc(c.nickname ?? ''),
        esc(c.tier ?? ''), esc(c.source ?? ''), esc(c.memo ?? ''),
        esc(c.nextFollowupDate ?? ''), esc((c.tags ?? []).map((t) => t.name).join('|')),
      ].join(','));
    }
    return '\uFEFF' + lines.join('\n');
  }

  /** 导出 vCard 3.0（可直接导入手机通讯录，含分组 CATEGORIES） */
  async exportVcf(): Promise<string> {
    const items = await this.loadContactsWithTags();
    const escV = (v: string) => String(v ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const out: string[] = [];
    for (const c of items) {
      out.push('BEGIN:VCARD', 'VERSION:3.0');
      out.push(`FN:${escV(c.name)}`);
      out.push(`N:${escV(c.name)};;;;`);
      if (c.phone) out.push(`TEL;TYPE=CELL:${escV(c.phone)}`);
      if (c.email) out.push(`EMAIL;TYPE=INTERNET:${escV(c.email)}`);
      if (c.company) out.push(`ORG:${escV(c.company)}`);
      if (c.memo) out.push(`NOTE:${escV(c.memo)}`);
      const tagNames = (c.tags ?? []).map((t) => t.name).filter(Boolean);
      if (tagNames.length > 0) out.push(`CATEGORIES:${tagNames.map(escV).join(',')}`);
      out.push('END:VCARD');
    }
    return out.join('\r\n') + '\r\n';
  }

  /** 层级值归一化（与 importXlsx 保持一致：未知值统一归 D） */
  private normalizeTierValue(v?: string): ContactTier {
    const raw = (v ?? '').trim().toUpperCase();
    if (['S', 'A', 'B', 'C', 'D', 'V'].includes(raw)) return raw as ContactTier;
    if (/^(U|未|未分类|未知|待定|无)$/i.test(raw)) return 'D';
    return 'D';
  }

  // ========== 通讯记录去重（短信/通话） ==========

  /** 短信/通话重复情况预览：先看规模再决定是否执行 */
  async getCommDedupPreview(): Promise<CommDedupPreviewResponse> {
    const userId = UserContext.getUserId();

    const smsTotals = await this.db.execute<{ groups: number; removable: number }>(sql`
      SELECT count(*)::int AS groups, coalesce(sum(cnt - 1), 0)::int AS removable
      FROM (
        SELECT phone, md5(body), count(*) AS cnt
        FROM messages WHERE user_id = ${userId}
        GROUP BY phone, md5(body) HAVING count(*) > 1
      ) t
    `);
    const smsSamples = await this.db.execute<{ phone: string; cnt: number; first_date: string; last_date: string; sample_body: string }>(sql`
      SELECT phone, count(*)::int AS cnt,
             min(message_date) AS first_date, max(message_date) AS last_date,
             substring((array_agg(body ORDER BY message_date ASC, id ASC))[1], 1, 30) AS sample_body
      FROM messages
      WHERE user_id = ${userId}
      GROUP BY phone, md5(body)
      HAVING count(*) > 1
      ORDER BY cnt DESC
      LIMIT 5
    `);

    const callTotals = await this.db.execute<{ groups: number; removable: number }>(sql`
      SELECT count(*)::int AS groups, coalesce(sum(cnt - 1), 0)::int AS removable
      FROM (
        SELECT phone, call_date, direction, duration, count(*) AS cnt
        FROM calls WHERE user_id = ${userId}
        GROUP BY phone, call_date, direction, duration HAVING count(*) > 1
      ) t
    `);
    const callSamples = await this.db.execute<{ phone: string; cnt: number; first_date: string; last_date: string; sample_body: string }>(sql`
      SELECT phone, count(*)::int AS cnt,
             min(call_date) AS first_date, max(call_date) AS last_date,
             direction || ' ' || duration || 's' AS sample_body
      FROM calls
      WHERE user_id = ${userId}
      GROUP BY phone, call_date, direction, duration
      HAVING count(*) > 1
      ORDER BY cnt DESC
      LIMIT 5
    `);

    const mapStat = (
      totals: Array<{ groups: number; removable: number }>,
      samples: Array<{ phone: string; cnt: number; first_date: string; last_date: string; sample_body: string }>,
    ): CommDedupStat => ({
      groups: totals[0]?.groups ?? 0,
      removable: totals[0]?.removable ?? 0,
      samples: samples.map((r) => ({
        phone: r.phone,
        count: r.cnt,
        firstDate: r.first_date,
        lastDate: r.last_date,
        preview: r.sample_body ?? '',
      })),
    });

    return {
      sms: mapStat(smsTotals, smsSamples),
      calls: mapStat(callTotals, callSamples),
    };
  }

  /**
   * 执行通讯记录去重（物理删除，先预览后执行）：
   * - sms：同号码+同内容视为重复，保留最早一条（日期平局保 id 最小）
   * - calls：同号码+同日期+同方向+同时长视为重复，保留最早入库的一条
   */
  async executeCommDedup(body: CommDedupExecuteRequest): Promise<CommDedupExecuteResponse> {
    const userId = UserContext.getUserId();
    const kind = body?.kind;
    if (kind !== 'sms' && kind !== 'calls') {
      throw new BadRequestException('kind 必须为 sms 或 calls');
    }

    if (kind === 'sms') {
      const [totals] = await this.db.execute<{ groups: number }>(sql`
        SELECT count(*)::int AS groups FROM (
          SELECT phone, md5(body) FROM messages
          WHERE user_id = ${userId}
          GROUP BY phone, md5(body) HAVING count(*) > 1
        ) t
      `);
      const [del] = await this.db.execute<{ deleted: number }>(sql`
        WITH d AS (
          DELETE FROM messages m
          WHERE m.user_id = ${userId}
            AND EXISTS (
              SELECT 1 FROM messages keeper
              WHERE keeper.user_id = m.user_id
                AND keeper.phone = m.phone
                AND md5(keeper.body) = md5(m.body)
                AND (keeper.message_date < m.message_date
                  OR (keeper.message_date = m.message_date AND keeper.id < m.id))
            )
          RETURNING id
        )
        SELECT count(*)::int AS deleted FROM d
      `);
      return { kind, groups: totals?.groups ?? 0, deleted: del?.deleted ?? 0 };
    }

    const [totals] = await this.db.execute<{ groups: number }>(sql`
      SELECT count(*)::int AS groups FROM (
        SELECT phone, call_date, direction, duration FROM calls
        WHERE user_id = ${userId}
        GROUP BY phone, call_date, direction, duration HAVING count(*) > 1
      ) t
    `);
    const [del] = await this.db.execute<{ deleted: number }>(sql`
      WITH d AS (
        DELETE FROM calls c
        WHERE c.user_id = ${userId}
          AND EXISTS (
            SELECT 1 FROM calls keeper
            WHERE keeper.user_id = c.user_id
              AND keeper.phone = c.phone
              AND keeper.call_date = c.call_date
              AND keeper.direction = c.direction
              AND keeper.duration = c.duration
              AND keeper.id < c.id
          )
        RETURNING id
      )
      SELECT count(*)::int AS deleted FROM d
    `);
    return { kind, groups: totals?.groups ?? 0, deleted: del?.deleted ?? 0 };
  }

  async clearAll(): Promise<{
    success: boolean;
    cleared: { contacts: number; tags: number; followups: number; batches: number; messages: number };
  }> {
    const userId = UserContext.getUserId();
    const result = await this.db.transaction(async (tx) => {
      // 删除顺序（按依赖反序）：followups / messages / merge_logs / contact_tags / contacts / tags
      // → 再清 traceability 表 import_batches / operation_logs
      // 多用户下全部仅作用于当前 userId，绝不触碰他人数据。
      const followupsDeleted = await tx.delete(followups).where(eq(followups.userId, userId)).returning({ id: followups.id });
      const messagesDeleted = await tx.delete(messages).where(eq(messages.userId, userId)).returning({ id: messages.id });
      const mergeLogsDeleted = await tx.delete(mergeLogs).where(eq(mergeLogs.userId, userId)).returning({ id: mergeLogs.id });
      const contactTagsDeleted = await tx.delete(contactTags).where(sql`${contactTags.contactId} IN (SELECT id FROM contacts WHERE user_id = ${userId})`).returning({ id: contactTags.id });
      const contactsDeleted = await tx.delete(contacts).where(eq(contacts.userId, userId)).returning({ id: contacts.id });
      const tagsDeleted = await tx.delete(tags).where(eq(tags.userId, userId)).returning({ id: tags.id });

      // ===== 追溯层清理（关键：否则清空后「数据时光机」仍残留旧批次，看起来像没清干净）=====
      // operation_logs 必须先于 import_batches 删除，二者通过 batchId 逻辑关联。
      await tx.delete(operationLogs).where(eq(operationLogs.userId, userId));
      const batchesDeleted = await tx.delete(importBatches).where(eq(importBatches.userId, userId)).returning({ id: importBatches.id });

      return {
        contacts: contactsDeleted.length,
        tags: tagsDeleted.length,
        followups: followupsDeleted.length,
        batches: batchesDeleted.length,
        messages: messagesDeleted.length,
        contactTags: contactTagsDeleted.length,
        mergeLogs: mergeLogsDeleted.length,
      };
    });

    return {
      success: true,
      cleared: {
        contacts: result.contacts,
        tags: result.tags,
        followups: result.followups,
        batches: result.batches,
        messages: result.messages,
      },
    };
  }

  /** ===== 标签智能推断 =====
   * 从姓名前缀（App 端习惯用 k/w/yj 等前缀做分组）、备注、备忘中识别身份与属性标签，
   * 帮助把「用文案模拟分组」的历史数据无损迁移到结构化标签体系。
   */
  private inferTagsFromText(
    name: string,
    nickname: string | null,
    memo: string | null,
    relationshipType: string | null,
    source: string | null,
  ): { tags: string[]; reasons: string[] } {
    const found = new Map<string, string>();
    const add = (tag: string, reason: string) => {
      if (!found.has(tag)) found.set(tag, reason);
    };
    const haystack = `${name} ${nickname ?? ''} ${memo ?? ''} ${relationshipType ?? ''} ${source ?? ''}`;

    // ① 姓名前缀（字母前缀隔断式命名，如 k康侬 / w宋 / yj付俊文）
    const m = name.trim().match(/^([a-zA-Z]{1,4})(?=[\u4e00-\u9fa5])/);
    if (m) {
      const prefix = m[1].toLowerCase();
      const PREFIX_TAG: Record<string, string> = {
        k: '客户', w: '客户', yj: '意向客户', z: '客户',
        t: '同行', p: '同行', g: '同行', f: '朋友', jr: '家人',
      };
      const tag = PREFIX_TAG[prefix];
      if (tag) add(tag, `姓名前缀 ${m[1]}`);
      else add('待归类', `姓名前缀 ${m[1]}`);
    }

    // ② 身份标签关键词匹配
    const IDENTITY_RULES: Array<[RegExp, string]> = [
      [/买房|购房|想买|要买|置业/, '买房客户'],
      [/卖房|出售|房源|业主/, '卖房业主'],
      [/租客|租房|承租/, '租客'],
      [/房东|出租/, '业主'],
      [/中介|同行|渠道|分销/, '中介同行'],
      [/同事/, '同事'],
      [/朋友|好友/, '朋友'],
      [/家人|亲属|亲戚/, '家人'],
      [/同学/, '同学'],
    ];
    for (const [re, tag] of IDENTITY_RULES) {
      if (re.test(haystack)) add(tag, `关键词「${tag}」`);
    }

    // ③ 属性标签关键词匹配
    const ATTRIBUTE_RULES: Array<[RegExp, string]> = [
      [/学区/, '学区房'],
      [/地铁|近地铁/, '地铁房'],
      [/改善/, '改善型'],
      [/刚需|首套/, '刚需'],
      [/投资|理财/, '投资'],
      [/二套/, '二套'],
      [/别墅|豪宅/, '豪宅'],
    ];
    for (const [re, tag] of ATTRIBUTE_RULES) {
      if (re.test(haystack)) add(tag, `关键词「${tag}」`);
    }

    return { tags: [...found.keys()], reasons: [...found.values()] };
  }

  async getTagInferPreview(body: TagInferPreviewRequest): Promise<TagInferPreviewResponse> {
    const uid = UserContext.getUserId();
    const conditions = [eq(contacts.archived, false), eq(contacts.userId, uid)];
    if (body?.contactIds && body.contactIds.length > 0) {
      conditions.push(inArray(contacts.id, body.contactIds));
    }

    const rows = await this.db
      .select({
        id: contacts.id,
        name: contacts.name,
        nickname: contacts.nickname,
        memo: contacts.memo,
        relationshipType: contacts.relationshipType,
        source: contacts.source,
      })
      .from(contacts)
      .where(and(...conditions));

    const items: TagInferItem[] = [];
    const tagSet = new Set<string>();
    for (const r of rows) {
      const { tags: hitTags, reasons } = this.inferTagsFromText(
        r.name,
        r.nickname,
        r.memo,
        r.relationshipType,
        r.source,
      );
      if (hitTags.length === 0) continue;
      items.push({ contactId: r.id, name: r.name, tags: hitTags, reasons });
      hitTags.forEach((t) => tagSet.add(t));
    }

    // 找出当前用户标签库中尚不存在的标签
    const existing = await this.db
      .select({ name: tags.name })
      .from(tags)
      .where(eq(tags.userId, uid));
    const existingNames = new Set(existing.map((t: { name: string }) => t.name));
    const newTags = [...tagSet].filter((t) => !existingNames.has(t));

    return { items, total: items.length, newTags };
  }

  async applyTagInfer(body: TagInferApplyRequest): Promise<TagInferApplyResponse> {
    const uid = UserContext.getUserId();
    if (!body?.items || body.items.length === 0) {
      return { added: 0, skipped: 0, createdTags: [] };
    }

    const createdTags: string[] = [];
    let added = 0;
    let skipped = 0;

    // 只处理属于当前用户的联系人，防越权
    const validIds = await this.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.userId, uid), inArray(contacts.id, body.items.map((i) => i.contactId))));
    const validIdSet = new Set(validIds.map((r: { id: string }) => r.id));

    // 加载/创建标签
    const existing = await this.db
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(eq(tags.userId, uid));
    const tagIdByName = new Map<string, string>(existing.map((t: { id: string; name: string }) => [t.name, t.id]));

    const allTagNames = [...new Set(body.items.flatMap((i) => i.tags))];
    for (const name of allTagNames) {
      if (tagIdByName.has(name)) continue;
      const [row] = await this.db
        .insert(tags)
        .values({ userId: uid, name, category: 'identity', color: '#3b82f6', sortOrder: 0 })
        .returning({ id: tags.id, name: tags.name });
      tagIdByName.set(row.name, row.id);
      createdTags.push(name);
    }

    // 建立关联（跳过已存在的）
    for (const item of body.items) {
      if (!validIdSet.has(item.contactId)) {
        skipped += item.tags.length;
        continue;
      }
      for (const tagName of item.tags) {
        const tagId = tagIdByName.get(tagName);
        if (!tagId) continue;
        const inserted = await this.db
          .insert(contactTags)
          .values({ contactId: item.contactId, tagId })
          .onConflictDoNothing()
          .returning({ id: contactTags.id });
        if (inserted.length > 0) added += 1;
        else skipped += 1;
      }
    }

    return { added, skipped, createdTags };
  }
}
