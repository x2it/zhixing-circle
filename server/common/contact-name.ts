import { eq, and, or, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { contacts } from '@server/database/schema';

export interface ContactNameMaps {
  /** contact_id → 姓名（优先用备注名） */
  byId: Map<string, string>;
  /** 手机号 / 备用号 → 姓名 */
  byPhone: Map<string, string>;
}

export const EMPTY_NAME_MAPS: ContactNameMaps = {
  byId: new Map<string, string>(),
  byPhone: new Map<string, string>(),
};

/**
 * 批量构建联系人姓名索引。
 *
 * 通信记录（短信 / 通话）在 App 按号码上传时常常只有 phone、没有 contact_id，
 * 因此除「id → 姓名」外再建一份「号码 → 姓名」索引作为回退，
 * 保证界面上尽量显示真实姓名，而不是一串裸号码。
 *
 * 只查询本次实际涉及的 id / 号码，避免全表扫描与 N+1 查询。
 */
export async function buildContactNameMaps(
  db: PostgresJsDatabase,
  userId: string,
  contactIds: string[],
  phones: string[],
): Promise<ContactNameMaps> {
  const idList = [...new Set(contactIds.filter(Boolean))];
  const phoneList = [...new Set(phones.filter(Boolean))];
  if (idList.length === 0 && phoneList.length === 0) return EMPTY_NAME_MAPS;

  const parts = [];
  if (idList.length > 0) parts.push(inArray(contacts.id, idList));
  if (phoneList.length > 0) {
    parts.push(inArray(contacts.phone, phoneList));
    parts.push(inArray(contacts.secondPhone, phoneList));
  }

  const rows = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      nickname: contacts.nickname,
      phone: contacts.phone,
      secondPhone: contacts.secondPhone,
    })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), or(...parts)));

  const byId = new Map<string, string>();
  const byPhone = new Map<string, string>();
  for (const c of rows) {
    const label = c.nickname || c.name;
    byId.set(c.id, label);
    if (c.phone) byPhone.set(c.phone, label);
    if (c.secondPhone) byPhone.set(c.secondPhone, label);
  }
  return { byId, byPhone };
}

/** 取姓名：contact_id 优先，缺失时按号码回退 */
export function resolveContactName(
  maps: ContactNameMaps,
  contactId?: string | null,
  phone?: string | null,
): string | undefined {
  if (contactId) {
    const byId = maps.byId.get(contactId);
    if (byId) return byId;
  }
  return phone ? maps.byPhone.get(phone) : undefined;
}
