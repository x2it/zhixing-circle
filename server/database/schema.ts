/* eslint-disable */
/** auto generated, do not edit */
import { sql } from 'drizzle-orm';
import { boolean, date, foreignKey, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, varchar, customType } from "drizzle-orm/pg-core"

export const customTimestamptz = customType<{
  data: Date;
  driverData: string;
  config: { precision?: number };
}>({
  dataType(config) {
    const precision = typeof config?.precision !== 'undefined'
      ? ` (${config.precision})`
      : '';
    return `timestamptz${precision}`;
  },
  toDriver(value: Date | string | number) {
    if (value == null) return value as any;
    if (typeof value === 'number') return new Date(value).toISOString();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    throw new Error('Invalid timestamp value');
  },
  fromDriver(value: string | Date): Date {
    if (value instanceof Date) return value;
    return new Date(value);
  },
});

export const userProfile = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'user_profile';
  },
  toDriver(value: string) {
    return sql`ROW(${value})::user_profile`;
  },
  fromDriver(value: string) {
    const [userId] = value.slice(1, -1).split(',');
    return userId.trim();
  },
});

export type FileAttachment = {
  bucket_id: string;
  file_path: string;
};

export const fileAttachment = customType<{
  data: FileAttachment;
  driverData: string;
}>({
  dataType() {
    return 'file_attachment';
  },
  toDriver(value: FileAttachment) {
    return sql`ROW(${value.bucket_id},${value.file_path})::file_attachment`;
  },
  fromDriver(value: string): FileAttachment {
    const [bucketId, filePath] = value.slice(1, -1).split(',');
    return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
  },
});

export function escapeLiteral(str: string): string {
  return "'" + str.replace(/'/g, "''") + "'";
}

export const userProfileArray = customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'user_profile[]';
  },
  toDriver(value: string[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::user_profile[]`;
    }
    const elements = value.map(id => `ROW(${escapeLiteral(id)})::user_profile`).join(',');
    return sql.raw(`ARRAY[${elements}]::user_profile[]`);
  },
  fromDriver(value: string): string[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => m.slice(1, -1).split(',')[0].trim());
  },
});

export const fileAttachmentArray = customType<{
  data: FileAttachment[];
  driverData: string;
}>({
  dataType() {
    return 'file_attachment[]';
  },
  toDriver(value: FileAttachment[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::file_attachment[]`;
    }
    const elements = value.map(f =>
      `ROW(${escapeLiteral(f.bucket_id)},${escapeLiteral(f.file_path)})::file_attachment`
    ).join(',');
    return sql.raw(`ARRAY[${elements}]::file_attachment[]`);
  },
  fromDriver(value: string): FileAttachment[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => {
      const [bucketId, filePath] = m.slice(1, -1).split(',');
      return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
    });
  },
});

export const mergeLogs = pgTable("merge_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  keepContactId: uuid("keep_contact_id").notNull(),
  keepContactName: varchar("keep_contact_name", { length: 100 }).notNull(),
  mergedContactIds: uuid("merged_contact_ids").array().notNull().default([]),
  mergedContactNames: varchar("merged_contact_names", { length: 100 }).array().notNull().default([]),
  mergedPhone: varchar("merged_phone", { length: 50 }),
  mergedFollowups: integer("merged_followups").notNull().default(0),
  mergedTags: integer("merged_tags").notNull().default(0),
  similarityType: varchar("similarity_type", { length: 20 }).notNull().default('phone'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_merge_logs_keep_contact_id").on(table.keepContactId),
  index("idx_merge_logs_created_at").on(table.createdAt),
  foreignKey({
    columns: [table.keepContactId],
    foreignColumns: [contacts.id],
    name: "merge_logs_keep_contact_id_fkey",
  }).onDelete("cascade"),
]);

export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  name: varchar("name", { length: 100 }).notNull(),
  source: varchar("source", { length: 50 }),
  contactCount: integer("contact_count").notNull().default(0),
  // ===== 批次追溯扩展（时光机）=====
  /** 来源渠道：app_sync / excel_import / json_import / web_manual / seed */
  channel: varchar("channel", { length: 30 }).default('web_manual'),
  /** 客户端标识（App 上报，如 TMA v1.8.0 / Android 14） */
  deviceInfo: varchar("device_info", { length: 200 }),
  /** 批次状态：active / reverted */
  status: varchar("status", { length: 20 }).notNull().default('active'),
  contactCreated: integer("contact_created").notNull().default(0),
  contactUpdated: integer("contact_updated").notNull().default(0),
  contactSkipped: integer("contact_skipped").notNull().default(0),
  followupCount: integer("followup_count").notNull().default(0),
  messageCount: integer("message_count").notNull().default(0),
  /** 回滚时间（未回滚为空） */
  revertedAt: customTimestamptz("reverted_at", { precision: 3 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
});

/** 操作流水：记录每次写操作，便于审计与追溯 */
export const operationLogs = pgTable("operation_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  batchId: uuid("batch_id"),
  /** 操作类型：batch_sync / import / create / update / delete / revert / dedup */
  action: varchar("action", { length: 50 }).notNull(),
  /** 来源渠道 */
  channel: varchar("channel", { length: 30 }),
  deviceInfo: varchar("device_info", { length: 200 }),
  /** 操作摘要（写入数量、影响范围等） */
  summary: jsonb("summary").default({}),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_operation_logs_user_id").on(table.userId),
  index("idx_operation_logs_batch_id").on(table.batchId),
  index("idx_operation_logs_created_at").on(table.createdAt),
]);

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  keyHash: varchar("key_hash", { length: 100 }).notNull().unique(),
  keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
  name: varchar("name", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  lastUsedAt: customTimestamptz("last_used_at", { precision: 3 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("api_keys_key_hash_key").on(table.keyHash),
  index("idx_api_keys_key_hash").on(table.keyHash),
  index("idx_api_keys_status").on(table.status),
]);

export const systemSettings = pgTable("system_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("system_settings_key_key").on(table.key),
]);

export const followups = pgTable("followups", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  contactId: uuid("contact_id").notNull(),
  content: text("content").notNull(),
  followupType: varchar("followup_type", { length: 20 }).default('wechat'),
  followupDate: date("followup_date").notNull().default('CURRENT_DATE'),
  nextFollowupDate: date("next_followup_date"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_followups_contact_id").on(table.contactId),
  foreignKey({
    columns: [table.contactId],
    foreignColumns: [contacts.id],
    name: "followups_contact_id_fkey",
  }).onDelete("cascade"),
]);

export const contactTags = pgTable("contact_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull(),
  tagId: uuid("tag_id").notNull(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("contact_tags_contact_id_tag_id_key").on(table.contactId, table.tagId),
  index("idx_contact_tags_contact_id").on(table.contactId),
  index("idx_contact_tags_tag_id").on(table.tagId),
  foreignKey({
    columns: [table.contactId],
    foreignColumns: [contacts.id],
    name: "contact_tags_contact_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.tagId],
    foreignColumns: [tags.id],
    name: "contact_tags_tag_id_fkey",
  }).onDelete("cascade"),
]);

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  name: varchar("name", { length: 100 }).notNull(),
  category: varchar("category", { length: 50 }).default('custom'),
  color: varchar("color", { length: 20 }).default('#64748b'),
  sortOrder: integer("sort_order").default(0),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
});

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  name: varchar("name", { length: 100 }).notNull(),
  nickname: varchar("nickname", { length: 100 }),
  phone: varchar("phone", { length: 50 }),
  wechat: varchar("wechat", { length: 100 }),
  tier: varchar("tier", { length: 20 }).default('C'),
  relationshipType: varchar("relationship_type", { length: 50 }),
  source: varchar("source", { length: 50 }),
  nextFollowupDate: date("next_followup_date"),
  followupNote: text("followup_note"),
  memo: text("memo"),
  archived: boolean("archived").notNull().default(false),
  batchId: uuid("batch_id"),
  // ===== App 同步扩展字段 =====
  secondPhone: varchar("second_phone", { length: 50 }),
  email: varchar("email", { length: 100 }),
  company: varchar("company", { length: 100 }),
  jobTitle: varchar("job_title", { length: 100 }),
  address: text("address"),
  birthday: date("birthday"),
  externalId: varchar("external_id", { length: 100 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_contacts_tier").on(table.tier),
  index("idx_contacts_next_followup_date").on(table.nextFollowupDate),
  index("idx_contacts_archived").on(table.archived),
  index("idx_contacts_batch_id").on(table.batchId),
  index("idx_contacts_user_id").on(table.userId),
  index("idx_contacts_external_id").on(table.externalId),
  // phone 唯一性（同一用户内）：部分唯一索引，仅约束非空 phone
  uniqueIndex("idx_contacts_user_phone_unique")
    .on(table.userId, table.phone)
    .where(sql`phone IS NOT NULL AND phone <> ''`),
]);

// table aliases
export const apiKeysTable = apiKeys;
export const contactTagsTable = contactTags;
export const contactsTable = contacts;
export const followupsTable = followups;
export const importBatchesTable = importBatches;
export const mergeLogsTable = mergeLogs;
export const systemSettingsTable = systemSettings;
export const tagsTable = tags;

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  contactId: uuid("contact_id"),
  phone: varchar("phone", { length: 50 }).notNull(),
  body: text("body").notNull(),
  // 'in' 收件 / 'out' 发件
  direction: varchar("direction", { length: 10 }).notNull().default('out'),
  // 短信发生时间, 格式 YYYY-MM-DD HH:mm (本地时间, 无时区语义)
  messageDate: varchar("message_date", { length: 20 }).notNull(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_messages_contact_id").on(table.contactId),
  index("idx_messages_phone").on(table.phone),
  index("idx_messages_date").on(table.messageDate),
  index("idx_messages_user_id").on(table.userId),
]);

export const messagesTable = messages;

/**
 * 通话记录（App 端通讯录备份）：与短信同属敏感数据，受「通话记录同步开关」控制。
 * 一条通话 = 一次互动证据，可与联系人关联（contactId 可空，按号码匹配）。
 */
export const calls = pgTable("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  contactId: uuid("contact_id"),
  phone: varchar("phone", { length: 50 }).notNull(),
  // 'in' 呼入 / 'out' 呼出 / 'missed' 未接
  direction: varchar("direction", { length: 10 }).notNull().default('out'),
  // 通话时长（秒），未接通为 0
  duration: integer("duration").notNull().default(0),
  // 通话发生时间, 格式 YYYY-MM-DD HH:mm (本地时间, 无时区语义)
  callDate: varchar("call_date", { length: 20 }).notNull(),
  note: text("note"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_calls_user_id").on(table.userId),
  index("idx_calls_phone").on(table.phone),
  index("idx_calls_contact_id").on(table.contactId),
  index("idx_calls_date").on(table.callDate),
]);

export const callsTable = calls;

// ===== 多用户与认证 =====

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 50 }).notNull(),
  passwordHash: varchar("password_hash", { length: 100 }).notNull(),
  displayName: varchar("display_name", { length: 100 }),
  role: varchar("role", { length: 20 }).notNull().default('user'),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("users_username_key").on(table.username),
]);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  // 存 token 的 sha256, 不存明文
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: customTimestamptz("expires_at", { precision: 3 }).notNull(),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("sessions_token_hash_key").on(table.tokenHash),
  index("idx_sessions_user_id").on(table.userId),
]);

export const recoveryCodes = pgTable("recovery_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  codeHash: varchar("code_hash", { length: 64 }).notNull(),
  usedAt: customTimestamptz("used_at", { precision: 3 }),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_recovery_codes_user_id").on(table.userId),
]);

export const usersTable = users;
export const sessionsTable = sessions;
export const recoveryCodesTable = recoveryCodes;
