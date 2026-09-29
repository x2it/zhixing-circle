import { Controller, Get, Header } from '@nestjs/common';

const SKILL_MD = `# 知行朋友圈 API Skill

## 系统简介

知行朋友圈是一款基于"ABC客户分层 + 弱关系维护"理论的个人人脉管理工具，帮助用户精细化运营人脉网络。通过联系人分层管理、标签体系、跟进记录等功能，让人脉维护更系统、更高效。

## 认证方式

系统支持两种鉴权方式（三端通用规则：未携带凭证的请求一律返回 401；密钥无效返回「API Key 无效或已撤销」）：

**方式一：API Key（推荐 App / 自动化客户端使用）**

支持以下传递方式（重要：经平台域名访问时，网关会剥离/改写自定义请求头，**请优先使用 URL 参数方式**）：

\`\`\`
# ✅ 方式 A（线上推荐，已实测穿透网关）：URL 参数
GET /api/contacts?api_key=zx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
POST /api/contacts/batch?api_key=zx_xxx   ← 写接口同样支持

# 方式 B（标准格式，本地/直连部署可用；经平台域名访问时请求头会被网关剥离）：
Authorization: Bearer zx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 方式 C：裸钥（省略 Bearer 前缀，直连可用）
Authorization: zx_xxx

# 方式 D：自定义头（直连可用）
X-API-Key: zx_xxx
\`\`\`

- 密钥以 \`zx_\` 开头，共 35 位字符；四种方式服务端均识别，取最先出现的 \`zx_\` 凭证
- **注意勿将含密钥的 URL 写入公开日志**；如密钥泄露，在「API 接入」页面撤销并重新生成
- 每个密钥绑定创建者的账号，数据按账号隔离

### API 密钥权限（可在网页端「API 接入」页配置）

密钥默认 **admin 全权**：与登录账号同级，能改所有字段、改模板、执行数据治理（清理脏数据 / 前缀清洗 / 批次合并 / 重复合并）。
**无论权限多高，密钥都只能操作它所属账号自己的数据**，跨账号访问一律 403。

| 级别 | 允许 | 禁止 |
|---|---|---|
| \`read\` | 所有 GET 查询 | 新增、修改、删除等一切写操作 |
| \`write\` | 增删改联系人/跟进/短信/通话、修改模板、**按 id 或 ids 批量删除** | 清空全部数据、数据治理、联系人合并、前缀清洗、密钥管理 |
| \`admin\`（默认） | 全部：读写的全部能力 + 清空数据 + 数据治理 + 合并清洗 + 批次合并 + 密钥管理 | 无 |

删除能力的判定：**按 id / 按 ids 列表删除属于 write**；\`{"all": true}\` 全量清空属于 **admin**（防误删兜底）。

可配置项：\`scope\`（级别）、\`rateLimitPerMin\`（每分钟请求上限，0=不限，超限返回 429 + Retry-After）、
\`allowedOps\`（操作白名单）、\`deniedOps\`（黑名单，优先级最高）。

\`\`\`
POST /api/api-keys?api_key=xxx
{ "name": "主力手机同步", "scope": "admin", "rateLimitPerMin": 0 }

PUT  /api/api-keys/{id}?api_key=xxx      # 修改名称/权限/速率
GET  /api/api-keys/{id}?api_key=xxx      # 查看权限配置
\`\`\`

需要 admin 的敏感操作：密钥管理、联系人合并、前缀清洗、按筛选批量操作、批次合并、清空数据。

**方式二：账号会话（网页端使用）**

- \`POST /api/auth/login\` 登录成功后服务端下发 HttpOnly Cookie（\`zx_session\`），有效期 30 天，浏览器自动携带
- App 端如需账号密码登录，也可调用下方「账号认证」接口并自行管理 Cookie

**数据隔离：** 所有业务数据按用户隔离，你只能看到自己创建的联系人、标签、跟进与短信。

## 基础地址

\`\`\`
{应用访问地址}/api
\`\`\`

所有接口均返回 JSON 格式响应。

## 移动端能力地图（TMA App 必读）

移动端与 PC 端**共用同一套 API、同一份数据**。以下按移动场景组织，是 App 端"真正能干活"的最小完整界面集。

### 移动端必备的 6 个界面

| # | 界面 | 解决的核心问题 | 依赖接口 |
|---|---|---|---|
| 1 | **今日跟进** | 今天/逾期该联系谁 | \`GET /api/dashboard/today-followups\`、\`GET /api/contacts?followupStatus=overdue\` |
| 2 | **联系人列表** | 快速找人 | \`GET /api/contacts\`（search / tier / tagId / followupStatus / sortBy） |
| 3 | **联系人详情** | 这人是谁、聊过什么 | \`GET /api/contacts/:id\` + \`GET /api/contacts/:id/followups\` + \`GET /api/calls?contactId=:id\` + \`GET /api/messages?contactId=:id\` |
| 4 | **记一次跟进** | 刚联系完，记下来 | \`POST /api/followups\`（可同时约定下次跟进日期） |
| 5 | **分层运营** | 谁该重点维护 | \`GET /api/dashboard/tier-groups\` + \`POST /api/data/batch/tier\` |
| 6 | **话术模板** | 发什么内容 | \`GET /api/templates/presets/list\` |

### 备份能力总览（通讯录类 App 关心的问题）

| 数据类型 | 是否支持 | 接口 | 开关 |
|---|---|---|---|
| **联系人**（姓名/昵称/电话/双号/微信/公司/职位/地址/生日/邮箱/备注/外部ID） | ✅ 支持 | \`POST /api/contacts\`、\`POST /api/contacts/batch\` | 无 |
| **标签**（可传 tagNames 自动建标签） | ✅ 支持 | 随联系人一起写入，或 \`POST /api/tags\` | 无 |
| **跟进记录**（内容/类型/日期/下次跟进） | ✅ 支持 | \`POST /api/followups\`、\`POST /api/followups/batch\` | 无 |
| **短信** | ✅ 支持 | \`POST /api/messages\`、\`POST /api/messages/batch\` | \`sms_sync_enabled\`，**默认关闭** |
| **通话记录**（呼入/呼出/未接/时长/时间/备注） | ✅ 支持 | \`POST /api/calls\`、\`POST /api/calls/batch\` | \`call_sync_enabled\`，**默认关闭** |

> 短信与通话属敏感数据，**默认关闭**。App 端首次备份前应先引导用户授权并调用开关接口开启（\`PUT /api/settings/sms-sync\`、\`PUT /api/settings/call-sync\`）。

### 移动端核心闭环（主战场）

「今日跟进」是整个移动端最高频的链路，务必打通：

\`\`\`
GET /api/dashboard/today-followups      ← 今日到期 + 已逾期的人（按跟进日期升序）
  → GET /api/contacts/:id                ← 看这个人是谁
  → GET /api/templates/presets/list      ← 取话术，复制发送
  → POST /api/followups                  ← 记一次跟进，顺带 nextFollowupDate 约定下次
  → 回到列表，该人从今日清单消失（闭环完成）
\`\`\`

### 按跟进日期筛选（移动端待办视图）

\`\`\`
GET /api/contacts?followupStatus=overdue    ← 逾期未跟进（最该处理）
GET /api/contacts?followupStatus=today      ← 今日待跟进
GET /api/contacts?followupStatus=week       ← 本周内待跟进
GET /api/contacts?followupStatus=none       ← 无跟进计划（需要安排）
GET /api/contacts?nextFollowupAfter=2026-09-28&nextFollowupBefore=2026-10-05   ← 自定义区间
GET /api/contacts?sortBy=nextFollowupDate&sortOrder=asc   ← 最早的待办排最前（推荐默认）
\`\`\`

### 与 PC 端的能力对照

**PC 端独占（数据整理/管理向，移动端无需实现）：**
- 批量导入（xlsx / workapp-excel）、查重合并、昵称清洗、手机号格式化
- 清空数据、API 密钥管理、示例数据
- 时光机（批次追溯 / 回滚）—— 移动端建议只保留只读查看：\`GET /api/batches\`

**移动端建议保留的简化版：**
- 导入：仅保留 \`POST /api/data/import/contacts\`（JSON 批量），不做 Excel 解析
- 批量操作：保留批量改分层、批量打标签即可

## 核心接口列表

### 1. 联系人管理

#### GET /api/contacts
获取联系人列表（分页）

**Query 参数：**
- \`page\`: 页码，默认 1
- \`pageSize\`: 每页数量，默认 20，**上限 100**（超出自动钳制，响应 \`pageSize\` 字段回显实际生效值）
- \`tier\`: 按层级筛选（S/A/B/C/D/V）
- \`search\`: 按姓名/昵称/手机号模糊搜索
- \`tagId\`: 按标签 ID 筛选
- \`archived\`: 是否包含已归档（\`true\`/\`false\`/\`all\`，默认 \`false\`）
- \`batchId\`: 按批次筛选（数据追溯用）
- \`followupStatus\`: **按下次跟进日期筛选**，\`overdue\` 逾期 / \`today\` 今日 / \`week\` 本周 / \`none\` 无计划
- \`nextFollowupAfter\` / \`nextFollowupBefore\`: 跟进日期区间（YYYY-MM-DD，含边界）
- \`sortBy\`: 排序字段 \`updatedAt\`（默认）/ \`nextFollowupDate\` / \`name\` / \`createdAt\`
- \`sortOrder\`: \`asc\` / \`desc\`；未指定时按 \`updatedAt\` 倒序、按 \`nextFollowupDate\` 升序（最早待办在前）

**响应示例：**
\`\`\`json
{
  "items": [
    {
      "id": "uuid",
      "name": "张三",
      "nickname": "A·张哥",
      "phone": "13800138000",
      "wechat": "zhangsan",
      "tier": "A",
      "source": "朋友介绍",
      "nextFollowupDate": "2026-10-01",
      "tags": [
        { "id": "uuid", "name": "企业主", "category": "identity", "color": "#3b82f6" }
      ],
      "createdAt": "2026-09-28T04:00:00.000Z",
      "updatedAt": "2026-09-28T04:00:00.000Z"
    }
  ],
  "total": 100,
  "page": 1,
  "pageSize": 20
}
\`\`\`

**时间戳说明：** 所有响应对象均包含 \`createdAt\` / \`updatedAt\`（ISO 8601 UTC，epoch 毫秒可用 \`new Date(s).getTime()\` 转换）；\`POST\` 创建后返回完整对象（含 \`id\`）；\`PUT\` 更新时服务端自动刷新 \`updatedAt\`，可直接用于多端合并时"时间最新者胜"的判断。

#### GET /api/contacts/:id
获取联系人详情

#### POST /api/contacts
创建联系人

**请求体：**
\`\`\`json
{
  "name": "张三",
  "nickname": "A·张哥",
  "phone": "13800138000",
  "secondPhone": "13900139000",
  "wechat": "zhangsan",
  "tier": "A",
  "relationshipType": "朋友",
  "source": "朋友介绍",
  "email": "zhangsan@example.com",
  "company": "某某科技",
  "jobTitle": "产品经理",
  "address": "杭州市西湖区",
  "birthday": "1990-01-01",
  "externalId": "app-internal-12345",
  "memo": "重要客户，对学区房有需求",
  "tagIds": ["uuid1", "uuid2"]
}
\`\`\`

**扩展字段说明（App 同步对齐）：** \`secondPhone\` 第二电话、\`email\` 邮箱、\`company\` 公司、\`jobTitle\` 职位、\`address\` 地址、\`birthday\` 生日（YYYY-MM-DD）、\`externalId\` 为 App 端本地唯一标识，服务端按用户+externalId 幂等查重。

**校验规则（强制）：**
- \`name\` 与 \`phone\` **至少一项非空**（空串、纯空白视为缺失），全部缺失返回 \`400\`，响应含字段级错误：
  \`\`\`json
  { "message": "name 与 phone 至少一项必填", "error": { "code": "VALIDATION_ERROR", "fieldErrors": { "name": ["name 与 phone 至少一项必填"] } } }
  \`\`\`
- \`phone\` 在**同一用户内唯一**，重复创建返回 \`409 CONFLICT\`（\`phone 已存在于其他联系人\`）；更新同理。
- \`tier\` 仅接受 \`S/A/B/C/D/V\`；**其他任何值（含 \`U\`、\`未\`、\`未知\` 等）服务端不会报错，统一静默归为 \`D\`（线索客户）**，这是既定归一化策略，App 端无需自行清洗。
- 仅提供 \`phone\` 不提供 \`name\` 时，服务端以 \`phone\` 兜底 \`name\` 字段（列表展示可读）。

#### PUT /api/contacts/:id
更新联系人信息（PUT 与 PATCH 均支持）

#### PATCH /api/contacts/:id
更新联系人信息（与 PUT 等价，推荐 App 使用）

**请求体（均可选，只传需要改的字段）：**
\`\`\`json
{ "name": "新名字", "tier": "S", "phone": "13800000000", "memo": "备注" }
\`\`\`

**校验规则（与创建一致）：** 更新后若 \`name\` 与 \`phone\` 同时为空返回 \`400\`；\`phone\` 与同用户其他联系人重复返回 \`409\`；\`tier\` 非法值静默归 \`D\`。

#### DELETE /api/contacts/:id
删除联系人（级联删除其跟进记录与标签关联）

### 1.5 批量操作（列表页多选场景）

#### POST /api/data/batch/tier
批量修改层级

**请求体：**
\`\`\`json
{ "contactIds": ["uuid1", "uuid2"], "tier": "A" }
\`\`\`
**响应：** \`{ "updated": 2 }\`

#### POST /api/data/batch/tags
批量打标签（\`mode\`: \`add\` 追加 / \`replace\` 覆盖已有标签）

**请求体：**
\`\`\`json
{ "contactIds": ["uuid1"], "tagIds": ["tagUuid1"], "mode": "add" }
\`\`\`
**响应：** \`{ "updated": 1 }\`

#### POST /api/data/batch/delete-no-phone
批量删除无电话联系人（保守：仅删当前用户、电话为空的联系人，级联清理跟进/标签）

**响应：** \`{ "deleted": 3 }\`

### 2. 标签管理

#### GET /api/tags
获取所有标签

#### GET /api/tags/:id
获取单个标签详情

**响应结构：**
\`\`\`json
{ "items": [ { "id": "uuid", "name": "高净值", "category": "attribute", "color": "#3b82f6", "sortOrder": 0 } ] }
\`\`\`

**Query 参数：**
- \`category\`: 按类别筛选（identity / attribute / custom）

#### POST /api/tags
创建标签

**请求体：**
\`\`\`json
{
  "name": "高净值",
  "category": "attribute",
  "color": "#3b82f6"
}
\`\`\`

#### PUT /api/tags/:id
更新标签（PUT 与 PATCH 均支持）

#### PATCH /api/tags/:id
更新标签（与 PUT 等价）

#### DELETE /api/tags/:id
删除标签

### 3. 跟进记录

#### GET /api/followups
获取跟进记录列表

**Query 参数：**
- \`contactId\`: 按联系人筛选
- \`page\`: 页码
- \`pageSize\`: 每页数量（默认 50，最大 200）

**响应：** \`Followup[]\` 数组，每条含 \`id\`、\`contactId\`、\`content\`、\`followupType\`、\`followupDate\`、\`nextFollowupDate\`、\`createdAt\`、\`updatedAt\`（ISO 8601）。

#### POST /api/followups
创建跟进记录（\`contactId\` 放在请求体中）

**请求体：**
\`\`\`json
{
  "contactId": "uuid",
  "content": "电话沟通了需求，对学区房很感兴趣",
  "followupType": "phone",
  "followupDate": "2026-09-28",
  "nextFollowupDate": "2026-10-05"
}
\`\`\`

**响应：** 完整 Followup 对象（含 \`id\`、\`createdAt\`、\`updatedAt\`）。

> 兼容路由：\`GET/POST /api/contacts/:contactId/followups\` 与上述接口等价。

#### PUT /api/followups/:id
更新跟进记录（同时支持 \`PATCH\`），服务端自动刷新 \`updatedAt\`

#### DELETE /api/followups/:id
删除跟进记录

### 3.5 批量接口（App 批量上报推荐）

单次最多 **100 条**；逐条独立处理，单条失败不影响其它，失败详情在 \`errors\` 数组中返回（\`index\` 对应请求 items 下标）。

**每次调用都会生成一个独立批次（云端自动），用于追溯与回滚。建议上报批次信息：**

| 字段 | 必填 | 说明 |
|---|---|---|
| \`batchName\` | 建议 | 批次名，如 \`TMA同步 2026-09-28 15:35\`。不传则自动生成 |
| \`source\` | 建议 | 固定传 \`tma\` |
| \`deviceInfo\` | 建议 | 客户端标识，如 \`TMA v1.8.0 / Android 14\` |

#### POST /api/contacts/batch
\`\`\`json
{
  "batchName": "TMA同步 2026-09-28 15:35",
  "source": "tma",
  "deviceInfo": "TMA v1.8.0 / Android 14",
  "items": [ { "name": "张三", "phone": "13800138000", "tier": "A", "externalId": "app-1", "tagNames": ["买房客户", "学区房"] } ]
}
\`\`\`

**响应：**
\`\`\`json
{
  "items": [ { "id": "uuid", "name": "张三", "...": "完整 Contact 对象" } ],
  "created": 1,
  "batchId": "uuid",
  "batchName": "TMA同步 2026-09-28 15:35",
  "skipped": 0
}
\`\`\`

- 携带 \`externalId\` 且已存在时直接返回已有联系人（幂等，不重复创建），适合断点续传
- \`tagNames\` 传标签名数组，云端自动创建不存在的标签并建立关联（也支持 \`tagIds\`）
- \`tier\` 仅接受 \`S/A/B/C/D/V\`；其他值（如 App 本地的 \`U\`）云端自动归为 \`D\`（线索）

#### POST /api/followups/batch
\`\`\`json
{ "batchName": "TMA跟进同步 2026-09-28 15:40", "source": "tma",
  "items": [ { "contactId": "uuid", "content": "电话沟通", "followupType": "phone", "followupDate": "2026-09-28" } ] }
\`\`\`

#### POST /api/messages/batch
\`\`\`json
{ "batchName": "TMA短信同步 2026-09-28 15:45", "source": "tma",
  "items": [ { "phone": "13800138000", "body": "你好", "direction": "out", "messageDate": "2026-09-28 14:30" } ] }
\`\`\`

同样受短信同步开关控制（关闭时 403）。

### 3.5.1 数据追溯与时光机（云端强制规范）

云端为**每一次数据写入**建立独立批次，可追溯、可回滚。这是数据安全的底线要求。

\`\`\`
GET  /api/batches                    获取批次列表（含渠道/设备/状态/统计）
GET  /api/batches/:id/detail         批次详情（含该批次写入的联系人清单）
GET  /api/batches/:id/diff           回滚预览（先看会发生什么，不执行）
POST /api/batches/:id/revert         执行回滚（保守策略）
GET  /api/batches/operations/logs    操作流水（审计每一次操作）
\`\`\`

**批次对象字段：**

| 字段 | 说明 |
|---|---|
| \`channel\` | 来源渠道：\`app_sync\` / \`excel_import\` / \`json_import\` / \`web_manual\` / \`seed\` |
| \`deviceInfo\` | 客户端标识 |
| \`status\` | \`active\` / \`reverted\` |
| \`contactCreated\` / \`contactSkipped\` | 新建数 / 幂等跳过数 |
| \`revertedAt\` | 回滚时间（未回滚为空） |

**回滚采用保守策略**（数据安全优先）：

- 该批次新建且**未被后续改动**的联系人 → 删除
- 已被**追加跟进或被修改**的联系人 → **保留**并在结果中说明原因
- **其他批次的数据绝不受影响**

**App 端建议**：同步前先 \`GET /api/batches\` 检查上次批次状态；若上次已被回滚（\`status=reverted\`），应**以云端为准**，不要立刻把数据推回。

### 3.6 账号认证（App 端账号密码登录）

#### POST /api/auth/login
\`\`\`json
{ "username": "admin", "password": "你的密码" }
\`\`\`

**响应：** \`Set-Cookie: zx_session=...; HttpOnly\` + \`{ "success": true, "user": { "id", "username", "displayName", "role" } }\`

- 连续失败 5 次将锁定 15 分钟

#### POST /api/auth/logout
退出登录，服务端销毁会话。

#### GET /api/auth/me
**移动端常用**：用 API Key 或会话换取当前身份，用于展示"当前账号"。

**响应：** \`{ "id": "uuid", "username": "admin", "displayName": "…", "role": "admin" }\`

#### GET /api/auth/status
系统是否已完成初始化、当前登录态。

#### POST /api/auth/change-password
\`\`\`json
{ "oldPassword": "旧密码", "newPassword": "至少 8 位新密码" }
\`\`\`

#### POST /api/auth/recover（免登录）
忘记密码时用一次性恢复码重置：
\`\`\`json
{ "username": "admin", "code": "rc_xxxxxxxxxxxxxxxxxxxx", "newPassword": "至少 8 位新密码" }
\`\`\`
恢复码一次性使用，重置后所有会话被清除。

### 4. 短信同步

短信为敏感数据，**开关默认关闭**（服务端无任何配置时 \`smsSyncEnabled\` 恒为 \`false\`）。短信的上报/列表读取受开关控制，未开启时返回 \`403\`（单条与批量一致）；**删除接口不受开关限制**（避免关闭态下残留数据无法清理）。

#### GET /api/settings/sms-sync
查询开关状态

**响应：**
\`\`\`json
{ "smsSyncEnabled": false }
\`\`\`

#### PUT /api/settings/sms-sync
切换开关

**请求体：**
\`\`\`json
{ "enabled": true }
\`\`\`

#### GET /api/messages
获取短信列表（分页，按 messageDate 倒序）

**Query 参数：**
- \`page\`: 页码，默认 1
- \`pageSize\`: 每页数量，默认 20，**上限 100**（超出自动钳制，响应 \`pageSize\` 字段回显实际生效值）
- \`contactId\`: 按联系人筛选
- \`phone\`: 按手机号筛选
- \`keyword\`: 关键词，同时匹配短信内容 / 号码 / 联系人姓名与备注名
- \`direction\`: \`in\`=收到 / \`out\`=发出
- \`dateFrom\` / \`dateTo\`: 日期范围 YYYY-MM-DD（含当天）
- \`sortOrder\`: \`desc\`=最新优先（默认） / \`asc\`=最早优先

**响应：**
\`\`\`json
{
  "items": [
    {
      "id": "uuid",
      "contactId": "uuid 或 null",
      "phone": "13800138000",
      "body": "短信内容",
      "direction": "in",
      "messageDate": "2026-09-28 14:30",
      "createdAt": "2026-09-28T04:00:00.000Z",
      "updatedAt": "2026-09-28T04:00:00.000Z"
    }
  ],
  "total": 100,
  "page": 1,
  "pageSize": 20
}
\`\`\`

#### POST /api/messages
上报短信（\`contactId\` 可空；提供时必须为已存在的联系人）

**请求体：**
\`\`\`json
{
  "contactId": "uuid 或省略",
  "phone": "13800138000",
  "body": "短信内容",
  "direction": "in",
  "messageDate": "2026-09-28 14:30"
}
\`\`\`

**字段说明：**
- \`direction\`: \`in\` 收件 / \`out\` 发件
- \`messageDate\`: 短信发生时间，固定格式 \`YYYY-MM-DD HH:mm\`（本地时间，无时区语义）
- **响应：** 完整 Message 对象（含 \`id\`、\`createdAt\`、\`updatedAt\`）

#### DELETE /api/messages/:id
删除单条短信。删除属于数据管理操作，**不受短信同步开关限制**。

**响应：** \`{ "success": true }\`；短信不存在返回 \`404\`。

#### DELETE /api/messages
批量删除短信（管理清理用，如清理验证残留数据）。

**请求体：**
\`\`\`json
{ "ids": ["uuid1", "uuid2"] }
\`\`\`

**响应：** \`{ "deleted": 2 }\`（实际删除条数，不存在的 id 静默跳过）；单次最多 100 条。

### 4.5 通话记录（App 通讯录备份）

与短信同属敏感数据，**开关默认关闭**（\`callSyncEnabled\` 默认 \`false\`）。上报/读取受开关控制，未开启返回 \`403\`；**删除不受开关限制**。

#### GET /api/settings/call-sync
查询开关状态 → \`{ "callSyncEnabled": false }\`

#### PUT /api/settings/call-sync
切换开关 → body \`{ "enabled": true }\`

#### GET /api/calls
通话记录列表（分页，默认按 callDate 倒序）

**Query：** \`page\`（默认 1）、\`pageSize\`（默认 20，上限 200）、\`contactId\`、\`phone\`、\`keyword\`（号码/联系人姓名/备注名）、\`direction\`（in/out/missed）、\`dateFrom\`/\`dateTo\`（YYYY-MM-DD，含当天）、\`minDuration\`/\`maxDuration\`（秒，含端点）、\`sortBy\`（date=通话时间默认 / duration=通话时长）、\`sortOrder\`（desc 默认 / asc）

#### POST /api/calls
上报单条通话记录

\`\`\`json
{
  "contactId": "uuid 或省略",
  "phone": "13800138000",
  "direction": "out",
  "duration": 125,
  "callDate": "2026-09-28 14:30",
  "note": "聊了学区房意向"
}
\`\`\`

**字段说明：**
- \`direction\`: \`in\` 呼入 / \`out\` 呼出 / \`missed\` 未接（其他值返回 400）
- \`duration\`: 通话时长（秒），0~86400 整数，未接通填 \`0\`
- \`callDate\`: 通话发生时间，固定格式 \`YYYY-MM-DD HH:mm\`
- \`note\`: 可选备注
- \`contactId\`: 可空；提供时必须为已存在的联系人，否则 404

#### POST /api/calls/batch
批量上报（单次最多 100 条），body \`{ "items": [ {...} ] }\`；开关关闭时整体 \`403\`

#### DELETE /api/calls/:id
删除单条（不受开关限制）→ \`{ "success": true }\`

#### DELETE /api/calls
批量删除，body \`{ "ids": ["uuid1"] }\` → \`{ "deleted": 1 }\`

#### DELETE /api/contacts
批量删除联系人，body \`{ "ids": ["uuid1", "uuid2"] }\` → \`{ "deleted": 2 }\`

- 单批最多 \`200\` 条；\`ids\` 缺失/非数组/为空 → \`400\`
- **幂等**：重复删同一批返回 \`200\` 且 \`deleted: 0\`，重试安全
- **用户隔离**：只删当前用户的数据，他人 id 一律不删（\`deleted\` 不计入）
- 级联清理该联系人的跟进记录、标签关联、合并留痕

#### DELETE /api/batches/batch
批量删除时光机批次，body \`{ "ids": ["uuid1"], "confirm": "DELETE" }\` → \`{ "results": [...], "totalDeletedContacts": n }\`

- 与「批量回滚」不同：这是**不可恢复**的彻底清理，批次记录连同其名下联系人一并删除
- \`confirm\` 必须为 \`DELETE\`，否则 \`400\`（防误触）

### 5. 仪表盘统计

#### GET /api/dashboard/stats
获取仪表盘汇总数据

**响应示例：**
\`\`\`json
{
  "totalContacts": 200,
  "tierSCount": 10,
  "tierACount": 30,
  "tierVCount": 5,
  "weekFollowupCount": 23,
  "tierDistribution": {
    "S": 10,
    "A": 30,
    "B": 60,
    "C": 80,
    "D": 20,
    "V": 5
  }
}
\`\`\`

**字段说明：**
- \`tierSCount\`/\`tierACount\`/\`tierVCount\`/\`weekFollowupCount\`：平铺快捷字段（历史兼容）
- \`tierDistribution\`：S/A/B/C/D/V 六层全量计数，结构化消费方推荐使用本字段

#### GET /api/dashboard/today-followups
**移动端「今日跟进」界面首选接口**：返回今日到期与已逾期的联系人，按跟进日期升序（最紧急在前）。

**Query：** \`batchId\`（可选）

**响应：** Contact 对象数组（每项含 \`id\`/\`name\`/\`phone\`/\`tier\`/\`nextFollowupDate\`/\`followupNote\` 等）

#### GET /api/dashboard/tier-groups
**移动端「分层运营」界面依赖**：返回 S/A/B/C/D/V 六层分组，每组含 \`count\` 与最多 10 条联系人预览。

**响应：**
\`\`\`json
[{ "tier": "S", "label": "S类 成交高价值", "count": 12, "contacts": [ /* Contact[] */ ] }]
\`\`\`

#### GET /api/dashboard/recent-activities
最近 20 条跟进动态（含 \`contactName\`），用于移动端"最近做了什么"时间线。

### 6. 导出与数据备份

#### GET /api/data/export/json
全量备份（JSON），含联系人/标签/跟进，可用于恢复

#### GET /api/data/export/vcf
导出 vCard 3.0（\`text/vcard\`），可直接导入手机通讯录。
标签会写入 \`CATEGORIES\` 字段 —— iOS/Android 通讯录按联系人分组导入时可识别。

#### GET /api/data/export/workapp-excel
导出工作 APP 格式表格（CSV，UTF-8 BOM，Excel 可直接打开）

#### GET /api/data/export/csv
导出通用 CSV

### 7. 健康检查

#### GET /api/health
进程存活探测（免鉴权）：\`{ "status": "ok" }\`

#### GET /api/health/deep
数据库连通性探测（免鉴权）：\`{ "status": "ok", "database": "up" }\`

### 8. 话术模板（移动端"发什么"）

#### GET /api/templates/presets/list
获取内置预设模板（无需创建，开箱可用）。

#### GET /api/templates
获取当前账号的全部模板。**每项带 \`isActive\` 字段，标记当前正在使用哪一个**（全库唯一）。

\`\`\`json
{
  "id": "uuid",
  "name": "房产经纪分层模板",
  "description": "…",
  "isPreset": true,
  "isActive": true,
  "tiers": [ { "tier": "S", "label": "成交高价值" } ],
  "identityTags": [ { "name": "买房客户", "color": "#3b82f6", "sortOrder": 0 } ],
  "attributeTags": [ { "name": "学区房", "sortOrder": 1 } ],
  "nicknameFormat": { "description": "…", "useTierPrefix": true, "tierSeparator": "·", "examples": [] }
}
\`\`\`

**App 端用法**：取 \`GET /api/templates\` 里 \`isActive === true\` 的那一项，就是用户当前选中的模板
（可能是内置预设，也可能是他自己的自定义模板）。用它渲染分层与标签体系。
若全部为 false，说明用户还没应用过任何模板，此时建议回退到第一项内置预设。

#### GET /api/templates/active/current
直接返回当前正在使用的模板（未应用过任何模板时返回 \`null\`）。比拉全量列表更省流量。

#### POST /api/templates/:id/apply
应用模板到当前账号（写入该模板的分层与标签体系），并把该模板标记为「当前使用」。
返回应用后的模板对象（\`isActive: true\`）。应用后其他模板的 \`isActive\` 自动变回 false。

#### POST /api/templates/align-tags
一键对齐：把标签库与当前激活模板对齐，保证「模板方案 = 标签体系」。三个动作：
1) 补齐模板定义但缺失的标签；2) 同步产生的同名标签转正；3) 模板之外的身份/属性标签降级到 sync 隔离区（不物理删除）。
返回对齐报告：\`{ templateId, templateName, createdIdentity[], createdAttribute[], promotedSync[], demoted[], totals{identity,attribute,sync} }\`。

### 9. 数据质量与智能分层建议

#### GET /api/data/quality
数据质量体检：缺失手机号/缺失分层/重复号码等统计，移动端"待完善"清单可用。

#### GET /api/data/tier-suggestions
基于跟进频次与互动情况给出分层调整建议（移动端批量分层时可先拉取建议再决定）。

#### POST /api/data/tier-suggestions/apply
应用建议，返回 \`{ "updated": N }\`。

#### GET /api/data/merge-logs
查重合并历史记录（只读）。

## 常见用法示例

### 示例 1：创建一个新联系人并打标签

\`\`\`bash
curl -X POST "{baseUrl}/api/contacts" \\
  -H "Authorization: Bearer zx_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "李总",
    "phone": "13900139000",
    "tier": "A",
    "source": "行业峰会",
    "memo": "关注改善型住房",
    "tagIds": ["tag-uuid-1", "tag-uuid-2"]
  }'
\`\`\`

### 示例 2：添加跟进记录

\`\`\`bash
curl -X POST "{baseUrl}/api/followups" \\
  -H "Authorization: Bearer zx_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contactId": "contact-uuid",
    "content": "线下见面，详细介绍了项目情况",
    "followupType": "meeting",
    "followupDate": "2026-09-28",
    "nextFollowupDate": "2026-10-05"
  }'
\`\`\`

### 示例 3：获取所有 A 级客户

\`\`\`bash
curl -X GET "{baseUrl}/api/contacts?tier=A&pageSize=100" \\
  -H "Authorization: Bearer zx_your_api_key_here"
\`\`\`

## 错误响应格式

所有错误响应统一携带顶层 \`message\` 字段，客户端直接读取即可：

\`\`\`json
{
  "message": "具体错误描述（中文）",
  "error": { "code": "NOT_FOUND", "message": "具体错误描述", "timestamp": 1759000000000 }
}
\`\`\`

## 同步可靠性规范（App 端上线前必读）

### 请求体上限：1MB 硬红线

平台网关对**单个请求体**有 1MB 上限。超出后请求不会到达应用服务器，网关直接返回 HTTP 500，
服务端日志里查不到任何记录。这是"同步失败 / 接口未开放"类报错最常见的原因。

| 体积 | 结果 |
|---|---|
| ≤ 993KB | 正常 201 |
| ≥ 1043KB | HTTP 500（网关拦截，应用层无感知） |

**正确做法**：启动时拉一次 \`GET /api/settings/sync-status\`，读取 \`limits\` 字段并据此切分批次：

\`\`\`json
"limits": {
  "maxItemsPerBatch": 200,
  "maxBodyBytes": 716800,
  "hardBodyBytes": 1048576,
  "maxConcurrency": 4,
  "maxItemChars": 2000,
  "note": "单批条数与请求体体积取小值切分；超过 1MB 会被网关直接拒绝（HTTP 500）"
}
\`\`\`

切分伪代码（条数与体积取小值，别只按条数切）：

\`\`\`
batch = []; bytes = 0
for item in pending:
    n = len(json.dumps(item, ensure_ascii=False).encode('utf-8'))
    if len(batch) >= limits.maxItemsPerBatch or bytes + n > limits.maxBodyBytes:
        send(batch); batch = []; bytes = 0
    batch.append(item); bytes += n
if batch: send(batch)
\`\`\`

注意：中文/emoji 在 JSON 里是 UTF-8 多字节，务必按 **编码后的字节数** 计算，不能用字符数。

### 大批量同步：分片上传通道（不想算体积就用它）

把数据拆成任意小片逐片上传，服务端攒齐后一次性写入。**每片 ≤ 100 条就绝对安全，不用管字节数。**

\`\`\`
POST /api/sync/upload/start?api_key=xxx
{ "kind": "contacts", "total": 2109, "batchName": "App同步", "deviceInfo": "Pixel 8" }
→ { "uploadId": "uuid", "limits": { ... } }

POST /api/sync/upload/chunk?api_key=xxx&uploadId=uuid
{ "items": [ ...100 条... ] }
→ { "uploadId": "uuid", "received": 100, "total": 2109 }   ← 重复调用继续追加

POST /api/sync/upload/commit?api_key=xxx&uploadId=uuid
→ { "items": [...], "created": 2109, "skipped": 0, "errors": [...] }
\`\`\`

- \`kind\` 取值：\`contacts\` / \`messages\` / \`calls\`
- 分片可串行也可并发（建议 ≤ 4 路），服务端按 uploadId 累加，顺序无关
- 会话 30 分钟无新分片自动过期；commit 后立即释放
- **commit 之前数据只在服务端内存里，不写库**；只有 commit 成功才算同步完成
- 写库逻辑与 \`/batch\` 完全一致（同样的字段校验、幂等去重、批次追溯、开关检查）
- 单次 \`/batch\` 上限已收紧为 **200 条**；超过 200 条请走分片通道

### 失败重试是安全的

所有批量接口都有幂等去重，同一批重复提交会返回 \`created: 0, skipped: N\`：

- 短信：号码 + 时刻 + 内容（md5）
- 通话：号码 + 时刻 + 方向 + 时长
- 联系人：externalId（强烈建议 App 端传，取通讯录 raw_contact_id）

失败时按 index 重试即可，不会造成重复数据。单条坏数据只进 \`errors\`，不影响同批其它条目。

### 同步开关

短信/通话默认 **关闭**。同步前先读开关，关闭状态推送会返回 403：

\`\`\`
GET /api/settings/sms-sync?api_key=xxx    → { "smsSyncEnabled": true }
GET /api/settings/call-sync?api_key=xxx   → { "callSyncEnabled": true }
\`\`\`

用户可在网页端「API 接入」页自行开关（开关与 API 密钥同页管理）。

常见状态码：\`401\` 未登录/凭证无效、\`403\` 禁止（如短信开关未开启、登录锁定）、\`404\` 资源不存在、\`400\` 参数错误。

## 注意事项

1. 日期统一为 YYYY-MM-DD；短信 \`messageDate\` / 通话 \`callDate\` 为 \`YYYY-MM-DD HH:mm\`。**服务端已做宽容归一化**：\`YYYY-MM-DD HH:mm:ss\`、ISO8601（含时区）、10/13 位时间戳都会被自动转换；无时区信息按字面取值，不做时区换算。通话 \`duration\` 支持 \`120\` / \`"120s"\` / \`"2:00"\`；\`direction\` 支持 \`in/incoming/呼入\`、\`out/outgoing/呼出\`、\`missed/未接\`
2. 层级可选值：S、A、B、C、D、V
3. 标签类别：identity（身份标签）、attribute（属性标签）、custom（自定义标签）
4. 建议将密钥存储在安全位置，不要在客户端代码中直接暴露
5. 如发现密钥泄露，请立即在「API 接入」页面撤销并重新生成
6. 多端同步建议：以 updatedAt（ISO 8601 UTC）做"时间最新者胜"合并；短信需先确认 smsSyncEnabled 为 true
7. **批量同步（必读，踩过坑）**：单批 ≤ 200 条 **且** 请求体 ≤ 700KB。平台网关对单个请求体有 1MB 硬上限，超出后请求根本到不了应用层，网关直接返回 **HTTP 500**（App 侧表现为"同步失败 / 服务器地址不正确或接口未开放"，服务端日志无任何记录，极易误判）。启动时先拉 \`GET /api/settings/sync-status\`，按返回的 \`limits\`（maxItemsPerBatch / maxBodyBytes / maxConcurrency）切分，不要硬编码批次大小
8. 大批量同步请串行或最多 4 路并发（超过会打满连接池）；单条文本超过 2000 字符会被服务端截断
9. 联系人携带 \`externalId\` 实现幂等；短信按「号码+时刻+内容」、通话按「号码+时刻+方向+时长」自动去重，**失败重试安全，不会重复入库**
`;

@Controller('api/skill.md')
export class SkillMdController {
  @Get()
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  getSkillMd(): string {
    return SKILL_MD;
  }
}
