export type ContactTier = 'S' | 'A' | 'B' | 'C' | 'D' | 'V';

export type FollowupType = 'phone' | 'wechat' | 'visit' | 'meeting' | string;

export type TagCategory = 'identity' | 'attribute' | 'custom';

export interface Contact {
  id: string;
  name: string;
  nickname?: string;
  phone?: string;
  /** 第二电话（App 同步扩展） */
  secondPhone?: string;
  wechat?: string;
  tier: ContactTier;
  memo?: string;
  /** 关系类型（App 同步扩展） */
  relationshipType?: string;
  /** 来源（App 同步扩展） */
  source?: string;
  /** 邮箱（App 同步扩展） */
  email?: string;
  /** 公司（App 同步扩展） */
  company?: string;
  /** 职位（App 同步扩展） */
  jobTitle?: string;
  /** 地址（App 同步扩展） */
  address?: string;
  /** 生日 YYYY-MM-DD（App 同步扩展） */
  birthday?: string;
  /** App 端唯一标识，用于幂等同步（App 同步扩展） */
  externalId?: string;
  nextFollowupDate?: string;
  followupNote?: string;
  tags: Tag[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  category: TagCategory;
  color: string;
  sortOrder: number;
}

export interface Followup {
  id: string;
  contactId: string;
  content: string;
  followupType: FollowupType;
  followupDate: string;
  nextFollowupDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImportBatch {
  id: string;
  name: string;
  source?: string;
  contactCount: number;
  createdAt: string;
  /** 来源渠道：app_sync / excel_import / json_import / web_manual / seed */
  channel?: string;
  /** 客户端标识 */
  deviceInfo?: string;
  /** 批次状态 */
  status?: 'active' | 'reverted';
  contactCreated?: number;
  contactUpdated?: number;
  contactSkipped?: number;
  followupCount?: number;
  messageCount?: number;
  revertedAt?: string;
}

export interface ImportBatchListResponse {
  items: ImportBatch[];
}

/** ===== 时光机（批次追溯）===== */

export interface BatchDetailContact {
  id: string;
  name: string;
  phone?: string;
  tier?: string;
  externalId?: string;
  createdAt: string;
  updatedAt: string;
  followupCount: number;
}

export interface BatchDetailResponse {
  batch: ImportBatch;
  contacts: BatchDetailContact[];
  total: number;
}

export interface BatchDiffResponse {
  batchId: string;
  batchName: string;
  /** 将被删除的数量 */
  willDelete: number;
  /** 将被保留的数量（已被后续操作改动） */
  willKeep: number;
  deletable: Array<{ id: string; name: string }>;
  modified: Array<{ id: string; name: string; reason: string }>;
  note: string;
}

export interface BatchRevertResponse {
  success: boolean;
  deleted: number;
  kept: number;
  keptItems: Array<{ id: string; name: string; reason: string }>;
}

/** POST /api/batches/revert-multi 请求体：批量回滚（时光机多选/全选） */
export interface RevertBatchesMultiRequest {
  ids: string[];
}

export interface BatchRevertMultiResponse {
  results: Array<{
    id: string;
    success: boolean;
    deleted: number;
    kept: number;
    error?: string;
  }>;
  totalDeleted: number;
  totalKept: number;
}

/** 批量删除批次：与批量回滚对称，用于彻底清理选中的同步批次 */
export interface RemoveBatchesMultiRequest {
  ids: string[];
  /** 安全确认串，前端要求用户输入后才允许批量删除 */
  confirm?: string;
}

export interface BatchRemoveMultiResponse {
  results: Array<{
    id: string;
    success: boolean;
    deletedContacts: number;
    error?: string;
  }>;
  totalDeletedContacts: number;
}

/** 通讯记录去重统计：短信按「号码+内容」，通话按「号码+日期+方向+时长」 */
export interface CommDedupStat {
  groups: number;
  removable: number;
  samples: Array<{ phone: string; count: number; firstDate: string; lastDate: string; preview: string }>;
}

export interface CommDedupPreviewResponse {
  sms: CommDedupStat;
  calls: CommDedupStat;
}

export interface CommDedupExecuteRequest {
  kind: 'sms' | 'calls';
}

export interface CommDedupExecuteResponse {
  kind: 'sms' | 'calls';
  groups: number;
  deleted: number;
}

// ===== 朋友圈分组（Moments）=====

/** 朋友圈自定义分组：按标签匹配（命中任一标签即入组），按用户隔离存储 */
export interface MomentsCustomGroup {
  id: string;
  name: string;
  description?: string;
  /** 标签名列表，命中任一即入组（OR 语义） */
  tagNames: string[];
  sortOrder: number;
}

/** 朋友圈周历条目：day 0=周一 … 6=周日 */
export interface MomentsCalendarItem {
  day: number;
  theme: string;
  content: string;
}

/** 朋友圈配置（自定义分组 + 周历），存 system_settings 按用户隔离 */
export interface MomentsConfig {
  customGroups: MomentsCustomGroup[];
  calendar: MomentsCalendarItem[];
}

export interface MomentsConfigResponse extends MomentsConfig {
  /** 周历是否仍是服务端默认建议（从未编辑过） */
  calendarIsDefault: boolean;
}

export type UpdateMomentsConfigRequest = Partial<MomentsConfig>;

// ===== 设备握手与同步健康 =====

/** 设备握手：App 启动时上报环境与能力，云端下发限制与特性开关 */
export interface DeviceHandshakeRequest {
  /** App 侧生成并持久化的设备唯一标识（UUID，卸载重装会变） */
  deviceId: string;
  /** App 版本，如 1.8.0 */
  appVersion?: string;
  /** Android / iOS */
  osName?: string;
  /** 系统版本，如 14 */
  osVersion?: string;
  /** 品牌，如 Xiaomi / HUAWEI */
  deviceBrand?: string;
  /** 机型，如 2304FPN6DC（Build.MODEL） */
  deviceModel?: string;
  /** App 自报能力清单，如 ['chunk-upload', 'real-timestamp'] */
  capabilities?: string[];
}

export interface DeviceHandshakeResponse {
  deviceId: string;
  /** 服务端当前时间（ISO8601），App 可用于校准本地时钟偏差 */
  serverTime: string;
  limits: SyncLimits;
  featureFlags: {
    /** 要求短信/通话必须传真实发生时间（不允许备份时刻） */
    requireRealTimestamp: boolean;
    /** 分片上传通道可用 */
    chunkUploadSupported: boolean;
  };
  /** 服务端接受的时间格式样例（App 端可据此自查） */
  dateFormatsAccepted: string[];
}

/** 已注册设备（Web 端健康面板展示用） */
export interface DeviceInfoItem {
  deviceId: string;
  appVersion?: string;
  osName?: string;
  osVersion?: string;
  deviceBrand?: string;
  deviceModel?: string;
  capabilities: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  handshakeCount: number;
}

/** 同步事件流水（来自 operation_logs 的 sync_start / sync_commit） */
export interface SyncEventItem {
  id: string;
  action: string;
  kind?: string;
  deviceInfo?: string;
  summary: Record<string, unknown>;
  createdAt: string;
}

export interface SyncHealthResponse {
  devices: DeviceInfoItem[];
  recentEvents: SyncEventItem[];
  stats: {
    totalEvents: number;
    /** 近 30 天 commit 存在失败条目的事件数 */
    failedCommits: number;
    lastErrorAt: string | null;
    lastErrorMessage: string | null;
  };
}

export interface OperationLogItem {
  id: string;
  batchId?: string;
  action: string;
  channel?: string;
  deviceInfo?: string;
  summary: Record<string, unknown>;
  createdAt: string;
}

export interface OperationLogListResponse {
  items: OperationLogItem[];
  total: number;
}

export interface XlsxImportRequest {
  batchName: string;
  source?: string;
  mode: ImportMode;
  duplicateStrategy: DuplicateStrategy;
  rows: Array<Record<string, string>>;
}

export interface XlsxImportResponse {
  success: boolean;
  batch?: ImportBatch;
  imported: number;
  skipped: number;
  failed: number;
  total: number;
  errors?: string[];
}

export interface ExportXlsxRequest {
  batchId?: string;
  includeArchived: boolean;
}

export interface ContactListQuery {
  search?: string;
  tier?: ContactTier | '';
  /** @deprecated 请使用 tagIds，保留仅用于兼容旧链接 */
  tagId?: string;
  /** 多标签筛选（通常逗号分隔传入） */
  tagIds?: string[];
  /** 多标签匹配模式：any=任一命中（默认），all=全部命中 */
  tagMode?: 'any' | 'all';
  page?: number;
  pageSize?: number;
  archived?: boolean | 'all';
  batchId?: string;
  /**
   * 按「下次跟进日期」筛选（移动端待办视图核心能力）：
   * - overdue 逾期未跟进（日期 < 今天）
   * - today 今日待跟进
   * - week 本周内（今天 ~ 本周日）
   * - none 无跟进计划（nextFollowupDate 为空）
   * 与 nextFollowupBefore/After 同时传入时以本字段优先
   */
  followupStatus?: 'overdue' | 'today' | 'week' | 'none';
  /** 下次跟进日期上界（YYYY-MM-DD，含当天） */
  nextFollowupBefore?: string;
  /** 下次跟进日期下界（YYYY-MM-DD，含当天） */
  nextFollowupAfter?: string;
  /** 手机号有无：with=有手机号，without=无手机号（排查 App 同步异常） */
  phoneStatus?: 'with' | 'without';
  /** 排序字段，默认 updatedAt；非法值服务端静默回退 updatedAt */
  sortBy?:
    | 'updatedAt'
    | 'createdAt'
    | 'name'
    | 'nickname'
    | 'phone'
    | 'tier'
    | 'nextFollowupDate'
    | 'followupNote'
    | 'tag';
  /** 排序方向，默认 desc（nextFollowupDate 默认 asc，最早的待办在前） */
  sortOrder?: 'asc' | 'desc';
}

export interface ContactListResponse {
  items: Contact[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateContactRequest {
  name: string;
  nickname?: string;
  phone?: string;
  secondPhone?: string;
  wechat?: string;
  tier: ContactTier;
  memo?: string;
  relationshipType?: string;
  source?: string;
  email?: string;
  company?: string;
  jobTitle?: string;
  address?: string;
  birthday?: string;
  externalId?: string;
  nextFollowupDate?: string;
  followupNote?: string;
  tagIds?: string[];
  /**
   * 标签名数组（App 端友好）：不存在的标签由云端自动创建。
   * 与 tagIds 可同时使用，云端会合并去重。
   */
  tagNames?: string[];
}

export interface UpdateContactRequest {
  name?: string;
  nickname?: string;
  phone?: string;
  secondPhone?: string;
  wechat?: string;
  tier?: ContactTier;
  memo?: string;
  relationshipType?: string;
  source?: string;
  email?: string;
  company?: string;
  jobTitle?: string;
  address?: string;
  birthday?: string;
  externalId?: string;
  nextFollowupDate?: string;
  followupNote?: string;
  tagIds?: string[];
  archived?: boolean;
}

export interface BatchArchiveRequest {
  contactIds: string[];
  archived: boolean;
}

/** 联系人筛选条件（按筛选批量操作 / 跨页全选用） */
export interface ContactFilter {
  batchId?: string;
  tier?: string;
  tagIds?: string[];
  archived?: boolean;
  keyword?: string;
}

export interface BatchByFilterRequest {
  filter: ContactFilter;
  action: 'archive' | 'unarchive' | 'addTags';
  /** action=addTags 时必填：要打上的标签 */
  tagIds?: string[];
}

export interface BatchByFilterResponse {
  matched: number;
  updated: number;
  tagsAdded?: number;
}

/** 名称前缀统计（智能清洗第一步：先识别再人工确认） */
export interface PrefixStat {
  prefix: string;
  count: number;
  examples: string[];
}

export interface PrefixCleanRequest {
  prefix: string;
  mode: 'strip' | 'tag';
  /** mode=tag 时必填：目标标签名 */
  tagName?: string;
  dryRun?: boolean;
}

export interface PrefixCleanResponse {
  matched: number;
  changed: number;
  skipped: number;
  preview: Array<{ id: string; name: string; newName?: string }>;
}

export interface MergeBatchesRequest {
  sourceIds: string[];
  /** 合并后的批次名，缺省沿用主批次名 */
  name?: string;
}

/** 重复候选中的单个联系人（用于人工比对决策） */
export interface DuplicateContact {
  id: string;
  name: string;
  nickname?: string;
  phone?: string;
  tier?: string;
  tagNames: string[];
  followupCount: number;
  messageCount: number;
  callCount: number;
  createdAt: string;
}

/**
 * 重复候选组：
 * - type='phone'：归一化手机号相同，强判重依据，默认建议合并
 * - type='name' ：仅姓名相同。同名未必同一人（两个「王姐」很常见），
 *   只作提示，不预设勾选，必须由人工确认后才可合并
 */
export interface DuplicateGroup {
  key: string;
  type: 'phone' | 'name';
  contacts: DuplicateContact[];
  /** 建议保留的主记录（信息完整度最高） */
  suggestedKeepId: string;
  /** 是否建议直接合并：type='name' 恒为 false */
  autoSuggest: boolean;
}

export interface MergeContactsRequest {
  /** 每组一个：保留谁、合并掉谁。必须由用户显式确认后提交，服务端不做任何自动合并 */
  groups: Array<{ keepId: string; mergeIds: string[] }>;
}

export interface MergeContactsResponse {
  mergedGroups: number;
  deletedContacts: number;
  movedTags: number;
  movedFollowups: number;
  movedMessages: number;
  movedCalls: number;
}

/** 导出范围：支持多选批次 */
export interface ExportOptions {
  batchIds?: string[];
  includeArchived?: boolean;
}

export interface CreateTagRequest {
  name: string;
  category: TagCategory;
  color?: string;
  sortOrder?: number;
}

export interface UpdateTagRequest {
  name?: string;
  category?: TagCategory;
  color?: string;
  sortOrder?: number;
}

export interface CreateFollowupRequest {
  contactId: string;
  content: string;
  followupType: FollowupType;
  followupDate: string;
  nextFollowupDate?: string;
}

export type MessageDirection = 'in' | 'out';

export interface Message {
  id: string;
  contactId?: string;
  /** 关联联系人姓名（列表接口批量补齐，未关联时为 undefined） */
  contactName?: string;
  phone: string;
  body: string;
  direction: MessageDirection;
  /** 短信发生时间, 格式 YYYY-MM-DD HH:mm */
  messageDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMessageRequest {
  contactId?: string;
  phone: string;
  body: string;
  direction: MessageDirection;
  messageDate: string;
}

export interface MessageListQuery {
  page?: number;
  pageSize?: number;
  contactId?: string;
  phone?: string;
}

export interface MessageListResponse {
  items: Message[];
  total: number;
  page: number;
  pageSize: number;
}

/** 短信会话：按号码聚合，用于聊天式浏览 */
export interface Conversation {
  phone: string;
  contactId?: string;
  contactName?: string;
  /** 该号码下的短信条数 */
  messageCount: number;
  /** 最后一条短信摘要 */
  lastBody: string;
  lastDirection: MessageDirection;
  lastMessageDate: string;
}

export interface ConversationListResponse {
  items: Conversation[];
  total: number;
  page: number;
  pageSize: number;
}

/** 备份同步状态：开关 + 云端条数 + 最近同步时间（不受开关限制，供 UI 自查） */
export interface SyncStatus {
  smsSyncEnabled: boolean;
  callSyncEnabled: boolean;
  smsTotal: number;
  callTotal: number;
  /** 最近一条短信的上报时间 ISO8601，无数据为 null */
  lastSmsSyncAt: string | null;
  lastCallSyncAt: string | null;
  /**
   * 云端下发的同步限流/分片建议。App 启动时拉一次并据此切分批次，
   * 避免硬编码批次大小导致的「请求体超过网关 1MB → HTTP 500」。
   */
  limits: SyncLimits;
}

/**
 * 同步分片上限。
 * maxBodyBytes 是硬红线：平台网关对单个请求体有 1MB 上限，超出后网关直接返回
 * 500（不会到达应用层），表现为「同步失败 / 接口未开放」。这里取 700KB 留 30% 余量，
 * 规避 JSON 转义、多字节中文、emoji 造成的体积膨胀。
 */
export interface SyncLimits {
  /** 单批建议最大条数（按体积兜底，取小值） */
  maxItemsPerBatch: number;
  /** 单批请求体建议上限（字节） */
  maxBodyBytes: number;
  /** 网关硬上限（字节），超过必然失败 */
  hardBodyBytes: number;
  /** 建议并发数：过高会打满连接池，实测 4 路稳定 */
  maxConcurrency: number;
  /** 单条 content/body 的最大字符数，超出会被截断（防单条撑爆整批） */
  maxItemChars: number;
  /** 给人看的说明 */
  note: string;
}

export interface SmsSyncSetting {
  smsSyncEnabled: boolean;
}

// ===== 通话记录 =====

/** 通话方向：in 呼入 / out 呼出 / missed 未接 */
export type CallDirection = 'in' | 'out' | 'missed';

export interface Call {
  id: string;
  contactId?: string;
  /** 关联联系人姓名（列表接口批量补齐，未关联时为 undefined） */
  contactName?: string;
  phone: string;
  direction: CallDirection;
  /** 通话时长（秒），未接通为 0 */
  duration: number;
  /** 通话发生时间，格式 YYYY-MM-DD HH:mm（本地时间，无时区语义） */
  callDate: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CallListResponse {
  items: Call[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CallSyncSetting {
  callSyncEnabled: boolean;
}

export interface DashboardStats {
  totalContacts: number;
  tierSCount: number;
  tierACount: number;
  tierVCount: number;
  weekFollowupCount: number;
  /** 全量分层分布（S/A/B/C/D/V 六层计数），与 tierSCount 等平铺字段并存 */
  tierDistribution: Record<ContactTier, number>;
}

export interface TierContactGroup {
  tier: ContactTier;
  label: string;
  count: number;
  contacts: Contact[];
}

export interface DashboardActivity extends Followup {
  contactName: string;
}

export interface ExportData {
  contacts: Contact[];
  tags: Tag[];
  followups: Followup[];
  exportedAt: string;
  version: string;
}

export interface UserInfo {
  id: string;
  username: string;
  displayName?: string;
  role: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  user: UserInfo;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  user?: UserInfo;
}

export interface ChangePasswordRequest {
  oldPassword: string;
  newPassword: string;
}

export interface RecoverPasswordRequest {
  username: string;
  code: string;
  newPassword: string;
}

export interface RecoveryCodesStatus {
  remaining: number;
}

export interface RecoveryCodesRegenerateResponse {
  codes: string[];
}

// ===== 批量同步接口（App 端批量上报, 单次最多 100 条） =====

export interface BatchCreateContactsRequest {
  items: CreateContactRequest[];
  /** 批次名（App 每次同步建议传，便于追溯）。不传则自动生成 */
  batchName?: string;
  /** 来源标识，如 tma */
  source?: string;
  /** 客户端标识，如 "TMA v1.8.0 / Android 14" */
  deviceInfo?: string;
}

export interface BatchCreateResult<T> {
  /** 全部成功时为 items */
  items: T[];
  /** 单条失败详情（index 对应请求 items 下标） */
  errors?: Array<{ index: number; message: string }>;
  created: number;
  /** 本次操作所属批次 id（用于追溯与回滚） */
  batchId?: string;
  /** 批次名 */
  batchName?: string;
  /** 因 externalId 幂等而跳过的数量 */
  skipped?: number;
}

export interface BatchCreateFollowupsRequest {
  items: CreateFollowupRequest[];
  /** 批次名（建议传） */
  batchName?: string;
  source?: string;
  deviceInfo?: string;
}

export interface BatchCreateMessagesRequest {
  items: CreateMessageRequest[];
  /** 批次名（建议传） */
  batchName?: string;
  source?: string;
  deviceInfo?: string;
}

export interface BatchCreateCallsRequest {
  items: Array<{
    contactId?: string;
    phone: string;
    direction: string;
    duration?: number | string;
    callDate: string | number;
    note?: string;
  }>;
  /** 批次名（建议传） */
  batchName?: string;
  source?: string;
  deviceInfo?: string;
}

export interface SuperGroup {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  contactIds: string[];
  count: number;
}

/** API Key 权限级别：read=只读 / write=读写 / admin=全权（等同账号，含危险与治理操作） */
export type ApiKeyScope = 'read' | 'write' | 'admin';

/** API Key 权限配置（缺省即全权，向后兼容历史密钥） */
export interface ApiKeyPermissions {
  /** 权限级别，默认 admin */
  scope: ApiKeyScope;
  /** 每分钟请求上限，0 表示不限速 */
  rateLimitPerMin: number;
  /** 允许的操作（空数组=不额外限制，按 scope 判定）；取值见 API_KEY_OPS */
  allowedOps?: string[];
  /** 显式禁止的操作（优先级高于 allowedOps 与 scope） */
  deniedOps?: string[];
}

export interface ApiKeyInfo {
  id: string;
  keyPrefix: string;
  name?: string;
  status: 'active' | 'revoked';
  createdAt: string;
  lastUsedAt?: string;
  /** 权限配置（缺省按 admin + 不限速处理） */
  permissions?: ApiKeyPermissions;
}

export interface CreateApiKeyRequest {
  name?: string;
  /** 权限级别，默认 admin（全权） */
  scope?: ApiKeyScope;
  /** 每分钟请求上限，0 或省略=不限速 */
  rateLimitPerMin?: number;
  allowedOps?: string[];
  deniedOps?: string[];
}

/** 更新 API Key（名称/权限/速率），仅影响归属用户自己的密钥 */
export interface UpdateApiKeyRequest extends CreateApiKeyRequest {}

export interface CreateApiKeyResponse {
  key: string;
  info: ApiKeyInfo;
}

export interface ApiKeyListResponse {
  items: ApiKeyInfo[];
}

/** 分片上传类型 */
export type SyncUploadKind = 'contacts' | 'messages' | 'calls';

/** 开始分片上传 */
export interface SyncUploadStartRequest {
  /** 上传数据种类 */
  kind: SyncUploadKind;
  /** 预计总条数（可选，用于进度展示） */
  total?: number;
  /** 批次名，不传则自动生成 */
  batchName?: string;
  /** 设备标识 */
  deviceInfo?: string;
}

export interface SyncUploadStartResponse {
  uploadId: string;
  /** 云端下发的同步限制，App 可按此切分 */
  limits: SyncLimits;
  /** 冗余字段：已收到条数（start 时固定为 0，兼容部分 App 把 start 当 chunk 解析） */
  received: number;
  /** 冗余字段：预计总条数 */
  total: number;
}

/** 上传一片数据 */
export interface SyncUploadChunkRequest {
  items: unknown[];
}

export interface SyncUploadChunkResponse {
  uploadId: string;
  /** 服务端已收到的累计条数 */
  received: number;
  /** 客户端声明的预计总条数 */
  total: number;
}

/** 提交分片上传并执行批量写入 */
export interface SyncUploadCommitResponse<T = unknown> extends BatchCreateResult<T> {
  uploadId: string;
}

export interface ClearDataResponse {
  success: boolean;
  cleared: {
    contacts: number;
    tags: number;
    followups: number;
    batches: number;
    messages: number;
  };
}

export interface DataQualityStats {
  totalContacts: number;
  duplicatePhoneCount: number;
  missingPhoneCount: number;
  missingTierCount: number;
  missingTagCount: number;
  invalidPhoneCount: number;
}

/** [旧版数据清洗] 重复组（与 contacts.findDuplicates 的 DuplicateGroup 区分） */
export interface DataCleanDuplicateGroup {
  groupKey: string;
  type: 'exact' | 'suspected';
  matchField: 'phone' | 'wechat' | 'name';
  matchValue: string;
  dedupType?: 'phone' | 'name';
  contacts: Array<{
    id: string;
    name: string;
    phone?: string;
    wechat?: string;
    tier?: string;
    memo?: string;
    followupCount: number;
    tagCount: number;
    infoScore: number;
  }>;
}

export interface DedupPreviewResponse {
  groups: DataCleanDuplicateGroup[];
  totalExactGroups: number;
  totalSuspectedGroups: number;
  totalDuplicateContacts: number;
}

export interface DedupExecuteRequest {
  groups: Array<{ groupKey: string; keepId: string; mergeIds: string[]; phone?: string; similarityType?: 'phone' | 'name' }>;
}

export interface DedupExecuteResponse {
  mergedGroups: number;
  deletedContacts: number;
  mergedFollowups: number;
  mergedTags: number;
}

export interface MergeLog {
  id: string;
  keepContactId: string;
  keepContactName: string;
  mergedContactIds: string[];
  mergedContactNames: string[];
  mergedPhone?: string;
  mergedFollowups: number;
  mergedTags: number;
  similarityType: 'phone' | 'name';
  createdAt: string;
}

export interface MergeLogListResponse {
  items: MergeLog[];
  total: number;
}

export interface PhoneNormalizeResult {
  updated: number;
  invalidCount: number;
  invalidContacts: Array<{ id: string; name: string; phone: string }>;
}

export interface TierSuggestion {
  id: string;
  name: string;
  phone?: string;
  currentTier: ContactTier;
  suggestedTier: ContactTier;
  reason: string;
  followupCount: number;
  lastFollowupDate?: string;
}

export interface TierSuggestionResponse {
  suggestions: TierSuggestion[];
  total: number;
}

export interface TierSuggestionApplyRequest {
  contactIds: string[];
}

export interface BatchTierUpdateRequest {
  contactIds: string[];
  tier: ContactTier;
}

export interface BatchTagRequest {
  contactIds: string[];
  tagIds: string[];
  mode: 'add' | 'replace';
}

export interface BatchDeleteNoPhoneResponse {
  deleted: number;
}

export interface ImportResult {
  success: number;
  skipped: number;
  failed: number;
  total: number;
  errors?: string[];
}

export type ImportMode = 'append' | 'overwrite';
export type DuplicateStrategy = 'skip' | 'update';

export interface WorkAppImportRequest {
  mode: ImportMode;
  duplicateStrategy: DuplicateStrategy;
  rows: Array<Record<string, string>>;
}

/** 工作 APP Excel 导入请求（与前端 importWorkAppExcel 对齐） */
export interface WorkAppExcelImportRequest {
  mode: ImportMode;
  duplicateStrategy: DuplicateStrategy;
  rows: Array<Record<string, string>>;
}

/** 通用联系人行导入请求（与前端 importContacts 对齐） */
export interface ContactImportRequest {
  mode: ImportMode;
  duplicateStrategy: DuplicateStrategy;
  source?: string;
  contacts: Array<Record<string, string>>;
}

export interface ContactImportRow {
  name: string;
  phone?: string;
  backupPhone?: string;
  wechat?: string;
  source?: string;
  area?: string;
  budgetMin?: string;
  budgetMax?: string;
  houseType?: string;
  targetProperty?: string;
  intentionLevel?: string;
  remark?: string;
  nextFollowupDate?: string;
}

export interface VcfContactRow {
  name: string;
  phone?: string;
  email?: string;
  org?: string;
  note?: string;
}

export type NicknameCleanOpType =
  | 'removeSpecialChars'
  | 'searchReplace'
  | 'addPrefix'
  | 'generateFromNamePhone'
  | 'normalizeHistoryPrefix';

export interface NicknameCleanOperation {
  type: NicknameCleanOpType;
  from?: string;
  to?: string;
  tierMap?: Record<string, string>;
  separator?: string;
}

export interface NicknameCleanPreviewRequest {
  contactIds?: string[];
  operations: NicknameCleanOperation[];
}

export interface NicknameCleanItem {
  contactId: string;
  oldName: string;
  newName: string;
}

export interface NicknameCleanPreviewResponse {
  items: NicknameCleanItem[];
  total: number;
}

export interface NicknameCleanExecuteRequest {
  items: NicknameCleanItem[];
}

export interface NicknameCleanExecuteResponse {
  updated: number;
  backup: Array<{ id: string; nickname: string | null }>;
}

/** ===== 标签智能推断（从姓名前缀 / 备注 / 备忘中识别身份与属性标签） ===== */

export interface TagInferPreviewRequest {
  /** 指定联系人；不传则扫描全部未归档联系人 */
  contactIds?: string[];
}

export interface TagInferItem {
  contactId: string;
  name: string;
  /** 命中的标签名 */
  tags: string[];
  /** 命中依据（用户可读，如「姓名前缀 k」） */
  reasons: string[];
}

export interface TagInferPreviewResponse {
  items: TagInferItem[];
  total: number;
  /** 待创建的标签（当前用户标签库中尚不存在） */
  newTags: string[];
}

export interface TagInferApplyRequest {
  items: TagInferItem[];
}

export interface TagInferApplyResponse {
  /** 新建的关联数 */
  added: number;
  /** 已存在跳过的关联数 */
  skipped: number;
  /** 新建的标签 */
  createdTags: string[];
}

export interface TemplateTier {
  value: string;
  label: string;
  description?: string;
  color: string;
  sortOrder: number;
}

export interface TemplateTag {
  name: string;
  color?: string;
  sortOrder: number;
}

export interface NicknameFormatConfig {
  description: string;
  useTierPrefix: boolean;
  tierSeparator: string;
  useKeyInfoBrackets: boolean;
  nonClientPrefixes: Array<{ prefix: string; label: string }>;
  relationSuffixes: Array<{ suffix: string; label: string }>;
  examples: string[];
}

/** 模板字段类型：App 端按类型渲染表单控件 */
export type TemplateFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'boolean'
  | 'select'
  | 'multiselect';

/** 模板字段定义：让 App 的表单字段跟随行业模板，无需内置字段 */
export interface TemplateField {
  /** 字段键，App 存储与上报用（如 budget） */
  key: string;
  /** 展示名（如 购房预算） */
  label: string;
  type: TemplateFieldType;
  /** select / multiselect 的可选项 */
  options?: string[];
  /** 分组：business 业务字段 / note 备注 */
  group: string;
  sortOrder: number;
  required?: boolean;
  placeholder?: string;
}

export interface ContactTemplate {
  id: string;
  name: string;
  description: string;
  isPreset: boolean;
  /**
   * 是否为当前正在使用的模板（按用户隔离，全库唯一一个）。
   * 应用模板（POST /api/templates/:id/apply）后该模板即为 true，
   * Web 端据此做视觉区分，App 端据此判断"默认模板是哪个"。
   */
  isActive?: boolean;
  tiers: TemplateTier[];
  identityTags: TemplateTag[];
  attributeTags: TemplateTag[];
  /** 行业业务字段定义；老模板缺省为空数组 */
  fields: TemplateField[];
  nicknameFormat: NicknameFormatConfig;
  /** 派生来源模板 id（「另存为新方案」时写入；纯手工新建为 null） */
  derivedFrom?: string | null;
  /** 派生那一刻源模板的完整内容快照，用于「重置为本方案的默认内容」 */
  baseSnapshot?: Omit<ContactTemplate, 'id' | 'isPreset' | 'createdAt' | 'updatedAt'> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateRequest {
  name: string;
  description: string;
  tiers: TemplateTier[];
  identityTags: TemplateTag[];
  attributeTags: TemplateTag[];
  fields?: TemplateField[];
  nicknameFormat: NicknameFormatConfig;
}

export interface UpdateTemplateRequest {
  name?: string;
  description?: string;
  tiers?: TemplateTier[];
  identityTags?: TemplateTag[];
  attributeTags?: TemplateTag[];
  fields?: TemplateField[];
  nicknameFormat?: NicknameFormatConfig;
}

/** POST /api/templates/reset-all 请求体：需显式确认，防误触 */
export interface ResetAllTemplatesRequest {
  confirm: 'RESET';
}

/** POST /api/templates/:id/duplicate 请求体：可自定义新方案名称，缺省为「原名称 副本」 */
export interface DuplicateTemplateRequest {
  name?: string;
}

/** POST /api/templates/:id/apply 响应：模板内容 + 应用报告；旧客户端忽略 applyReport 字段即可 */
export type ApplyTemplateResponse = ContactTemplate & { applyReport: TemplateApplyReport };

/** apply 的结果报告：本次写入了哪些标签、跳过了哪些同名标签 */
export interface TemplateApplyReport {
  createdIdentityTags: string[];
  createdAttributeTags: string[];
  skippedIdentityTags: string[];
  skippedAttributeTags: string[];
}

/** POST /api/templates/align-tags 响应：标签库与激活模板对齐的报告 */
export interface AlignTagsResponse {
  templateId: string;
  templateName: string;
  /** 本次新建的模板标签（库中此前缺失） */
  createdIdentity: string[];
  createdAttribute: string[];
  /** 从 sync 隔离区转正的标签（与模板同名） */
  promotedSync: string[];
  /** 降级到 sync 隔离区的标签（模板之外的身份/属性标签，未物理删除，可找回） */
  demoted: string[];
  /** 对齐后各类目数量 */
  totals: { identity: number; attribute: number; sync: number };
}

export interface TemplateListResponse {
  items: ContactTemplate[];
}

// ===== 话术模板 =====

export interface TalkScript {
  id: string;
  /** 话术标题 */
  title: string;
  /** 使用场景，如 破冰 / 跟进 / 邀约 / 成交 / 回访 */
  scene: string;
  /** 适用层级（可选），如 S / A */
  tier?: string;
  /** 话术正文，支持 {称呼} 等占位符 */
  content: string;
  isPreset: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTalkScriptRequest {
  title: string;
  scene?: string;
  tier?: string;
  content: string;
}

export interface UpdateTalkScriptRequest {
  title?: string;
  scene?: string;
  tier?: string;
  content?: string;
}
