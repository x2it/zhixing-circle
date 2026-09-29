# 知行朋友圈 · App 端接口对接说明（v2.7.3）

> 面向 App 端同学。2026-09-29 更新，**所有结论均在生产环境实测得出**。
> v2.7.3 新增：**设备握手接口**（App 启动时上报环境与能力，云端下发限制与规范，见第十二章）+ **「我是Davi」模板标签体系全量替换**（33 个真实业务身份标签，App 端拉取 presets/list 即可看到）。
> v2.7.2：**短信/通话去重**（Web 端数据治理，App 无需对接）+ **`messageDate`/`callDate` 必须传真实时间**——当前 App 端传的是备份时刻，云端短信/通话日期全错，这是 App 端必须修的一个点（见第十一章）。
> v2.7.1：**模板派生与重置**（另存为新方案 / 单方案重置 / 恢复出厂 / apply 报告）+ **6 个行业预设模板**（房产模板已更名为「我是Davi」）。
> v2.7.0：模板「当前使用」标识（App 端可识别用户选中的模板）。

接口地址：`https://<你的部署域名>/api`（本文档中的示例统一以 `$BASE` 表示）

---

## 零、先给结论：同步失败的根因

这轮把「短信同步 HTTP 500」「双向同步 586 条失败」「服务器地址不正确或接口未开放」一次性查到底了。
**根因只有一句话：平台网关对单个请求体有 1MB 硬上限，超出后请求根本到不了服务端。**

### 实测证据（生产环境二分定位）

| 请求体体积 | 结果 |
|---|---|
| 543 KB | ✅ 201 |
| 743 KB | ✅ 201 |
| 893 KB | ✅ 201 |
| 993 KB | ✅ 201 |
| **1043 KB** | ❌ **HTTP 500** |
| 2 MB | ❌ HTTP 500 |

关键特征：**服务端日志里查不到任何记录**。因为请求被网关拦在应用层之外，
直接返回 500，所以排查时很容易误判成「服务端崩了」或「接口路径不对」。

已排除的其他可能性（都实测过，不是它们）：

| 怀疑项 | 实测结论 |
|---|---|
| 应用 bodyParser 100kb 限制 | ❌ 不是。已放宽到 20mb，且 543KB 也能过 |
| 数据库连接池耗尽 / 并发 | ❌ 不是。12 路并发 × 300 条全部 201 |
| 接口路径不存在 | ❌ 不是。全量路由逐个探测均可达 |
| gzip 压缩上传绕过限制 | ❌ 不行。网关不接受 gzip 请求体，同样 500 |
| 时间格式校验失败 | ⚠️ **是次要原因之一**（详见第三节），已修复 |

---

## 一、App 端要改的（二选一）

### 方案 A：按体积切分（改动最小，10 行代码）

**把固定的「每批 500 条」改成「条数与体积取小值切分」。**

### 正确做法：启动时读云端下发的限制

```
GET /api/settings/sync-status?api_key=xxx
```

现在响应里多了一个 `limits` 字段，**App 启动时拉一次并缓存**，按它切分，别再硬编码：

```json
{
  "smsSyncEnabled": true,
  "callSyncEnabled": true,
  "smsTotal": 3633,
  "callTotal": 2001,
  "lastSmsSyncAt": "2026-09-28T22:58:42.802Z",
  "lastCallSyncAt": "2026-09-28T21:36:23.326Z",
  "limits": {
    "maxItemsPerBatch": 200,
    "maxBodyBytes": 716800,
    "hardBodyBytes": 1048576,
    "maxConcurrency": 4,
    "maxItemChars": 2000,
    "note": "单批条数与请求体体积取小值切分；超过 1MB 会被网关直接拒绝（HTTP 500）"
  }
}
```

### 切分伪代码（Kotlin / Swift 通用思路）

```
batch = []; bytes = 0
for item in pending:
    n = utf8ByteLength(jsonEncode(item))      // 必须按编码后的字节数算
    if batch.size >= limits.maxItemsPerBatch || bytes + n > limits.maxBodyBytes:
        send(batch); batch = []; bytes = 0
    batch.add(item); bytes += n
if batch.isNotEmpty(): send(batch)
```

⚠️ **坑**：中文和 emoji 在 UTF-8 里是多字节，`"你好"` 是 6 字节不是 2 字符。
必须按 `jsonEncode(item).toByteArray(UTF_8).size` 计算，用字符数会低估 2~4 倍，照样超 1MB。

### 为什么是 200 条 / 700KB

- 700KB 相对 1MB 红线留了 30% 余量，用来吸收 JSON 转义、多字节字符、emoji 的膨胀
- 200 条是体积之外的第二重保险：短信含群发长文本、emoji 时单条可达数 KB
- 实测 500 条短信约 60~180KB 是安全的，但当短信内容偏长时会突破 1MB。**不按体积切分就一定会偶发失败**——这正好解释了为什么「有时候成功、有时候失败」

### 方案 B：分片上传通道（推荐，不用算体积）✅

如果不想自己算字节数，直接用新加的分片上传通道：**把数据拆成任意小片逐片上传，服务端攒齐后一次性写入**。
每片只要 ≤ 100 条就绝对安全，完全不用管体积。

```
POST /api/sync/upload/start?api_key=xxx
{ "kind": "contacts", "total": 2109, "batchName": "App同步", "deviceInfo": "Pixel 8" }
→ { "uploadId": "uuid", "limits": { ... } }

POST /api/sync/upload/chunk?api_key=xxx&uploadId=uuid
{ "items": [ ...100 条... ] }
→ { "uploadId": "uuid", "received": 100, "total": 2109 }   ← 重复调用继续追加

POST /api/sync/upload/commit?api_key=xxx&uploadId=uuid
→ { "created": 2109, "skipped": 0, "errors": [...] }
```

| 项 | 说明 |
|---|---|
| `kind` | `contacts` / `messages` / `calls` |
| 分片顺序 | 无关，服务端按 `uploadId` 累加 |
| 并发 | 可并发，建议 ≤ 4 路 |
| 过期 | 30 分钟无新分片自动释放；`commit` 后立即释放 |
| 写库时机 | **commit 之前只在内存里，不写库**；只有 commit 成功才算同步完成 |
| 写库逻辑 | 与 `/batch` 完全一致（同样的字段校验、幂等去重、批次追溯、同步开关检查） |

实测：1000 条联系人分 10 片上传 → commit **201，1.3 秒，created 1000，0 错误**。

> ⚠️ 单次 `/batch` 的条数上限已收紧为 **200 条**（原来是 500）。超过 200 条会收到
> `400 单次批量最多 200 条`，此时请走分片通道。这个收紧本身就是保护——避免你一次性发太多被网关 500。

---

## 二、次要原因：时间/方向格式太严格（服务端已修，App 端无需改）

原来服务端用严格正则 `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$` 校验时间，
**App 端只要传了 `2026-09-28 10:00:00`（带秒）或 ISO8601，整条就会被拒**，
这也会累积成「N 条失败」而服务端看起来毫无异常。

服务端已做宽容归一化，以下写法现在**全部接受**（实测通过）：

| 字段 | 现在接受的写法 |
|---|---|
| `messageDate` / `callDate` | `2026-09-28 10:00`、`2026-09-28 10:00:00`、`2026-09-28T10:00:00+08:00`、`2026-09-28T10:00:00Z`、13 位毫秒时间戳、10 位秒级时间戳 |
| 短信 `direction` | `in`/`incoming`/`inbound`/`received`/`呼入`/`来电`/`1`，`out`/`outgoing`/`sent`/`呼出`/`去电`/`2` |
| 通话 `direction` | 上述之外再加 `missed`/`missed_call`/`未接`/`拒接`/`3` |
| 通话 `duration` | `120`、`"120"`、`"120s"`、`"2:00"`、`"1:30:00"` |

无时区信息的时间**按字面取值，不做时区换算**；带时区的按服务端时区转换。
单条文本超过 2000 字符会被截断（防止单条撑爆整批）。

---

## 三、服务端这轮做的加固（App 端无感，但更稳了）

| 项 | 改动 | 效果 |
|---|---|---|
| **分片上传通道** | 新增 `/api/sync/upload/{start,chunk,commit}` | 大批量同步彻底绕开 1MB 网关限制，App 不用算体积 |
| **单次批量上限** | 500 条 → **200 条** | 超过即 400 明确报错，不再静默被网关 500 |
| 联系人批量写入 | 逐条事务 → 每 100 条一个事务 + 多行 INSERT | **500 条 8.5s → 1.7s**（快 5 倍），大批量不再逼近网关超时 |
| 请求体限制 | 应用层放宽到 20mb | 应用层不再是瓶颈 |
| 时间/方向/时长 | 宽容归一化 | 格式差异不再导致整条被拒 |
| 单条截断 | 超过 2000 字符自动截断 | 防止单条撑爆整批 |
| 失败降级 | 整块事务失败时自动退化为逐条重试 | 一条坏数据不再拖垮 100 条 |
| 同步限制下发 | `sync-status` 返回 `limits` | App 端可自适应，不用硬编码 |

---

## 四、幂等保证（失败重试绝对安全）

- 短信：`phone + messageDate + md5(body)`
- 通话：`phone + callDate + direction + duration`
- 联系人：`externalId`（**强烈建议 App 端传，取通讯录 raw_contact_id**）

同批重推实测：首次 `created:500, skipped:0`，重推 `created:0, skipped:500`。
**任何批次都可以无脑重试，不会产生重复数据。**

---

## 五、自测清单（改完请逐项验证）

**分片通道（方案 B）**：

- [ ] `start` 能拿到 `uploadId`
- [ ] 连传 10 片 × 100 条，`received` 从 100 累加到 1000
- [ ] `commit` 返回 `created:1000`，耗时 < 3s
- [ ] 同一批再走一遍完整流程，第二次 `created:0, skipped:1000`（幂等生效）
- [ ] 传错 `kind`（如 `"kind":"xxx"`）返回 400
- [ ] 拿错误的 `uploadId` 调 chunk 返回 404

**按体积切分（方案 A）**：

- [ ] 启动时拉 `sync-status`，打印 `limits` 并按它切分
- [ ] 500 条短信按体积切成 3 批推送，全部 201
- [ ] 发 201 条应收到 `400 单次批量最多 200 条`
- [ ] 同一批连推两次，第二次 `created:0, skipped:N`（幂等生效）
- [ ] 故意构造一批 1.5MB 的超大包，确认**已被本地切分**而不是发出去 500

**通用**：

- [ ] 带秒的时间格式（`2026-09-28 10:00:30`）能成功入库
- [ ] 通话传 `"duration":"2:00"` 能成功入库（应为 120 秒）
- [ ] 收到 500 时，App 提示「数据量过大，已自动分批重试」而不是「接口未开放」
- [ ] Web 端「沟通记录」页能看到同步上来的数据

---

## 六、可直接复制的自测命令

```bash
KEY="zx_你的密钥"
BASE="https://<你的部署域名>/api"

# 1. 读云端下发的同步限制
curl "$BASE/settings/sync-status?api_key=$KEY" | python3 -m json.tool

# 2. 各种时间格式一起推（应全部成功，不再是 errors）
curl -X POST "$BASE/messages/batch?api_key=$KEY" \
  -H 'Content-Type: application/json' \
  -d '{"items":[
    {"phone":"13800138000","body":"带秒","direction":"in","messageDate":"2026-09-27 08:30:45"},
    {"phone":"13800138001","body":"ISO","direction":"outgoing","messageDate":"2026-09-27T09:15:00+08:00"},
    {"phone":"13800138002","body":"时间戳","direction":"2","messageDate":1759000000000}
  ]}'

# 3. 再推一次，应返回 created:0 skipped:3
# （用上面同样的 body 再发一遍）

# 4. 通话：未接 + duration 字符串
curl -X POST "$BASE/calls/batch?api_key=$KEY" \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"phone":"13800138000","direction":"未接","duration":"2:00","callDate":"2026-09-27 09:00"}]}'
```

---

## 八、联系人列表排序/筛选字段（v2.7.1 新增）

Web 端联系人列表现在支持表头排序 + 跟进筛选 + 无手机号排查。App 端如果也需要本地排序，可以参考这些字段；如果 App 只是同步数据，这些字段与你无关。

### 排序字段

`GET /api/contacts` 新增参数：

| 参数 | 取值 | 说明 |
|---|---|---|
| `sortBy` | `updatedAt` / `createdAt` / `name` / `nickname` / `phone` / `tier` / `nextFollowupDate` / `followupNote` / `tag` | 排序字段，非法值静默回退 `updatedAt` |
| `sortOrder` | `asc` / `desc` | 排序方向；`nextFollowupDate` 默认 `asc`（最早待办在前），其余默认 `desc` |

注意：
- `tier` 按业务序 `S > A > B > C > V > D`，不是字母序。
- `tag` 按"字母序最小标签名"排，无标签沉底。
- 所有排序空值统一沉底，不会跳到顶部。

### 筛选字段

| 参数 | 取值 | 说明 |
|---|---|---|
| `tagIds` | 逗号分隔的标签 id，如 `a,b,c` | 多标签筛选（替代旧 `tagId`） |
| `tagMode` | `any`（默认）/ `all` | `any`=任一命中；`all`=全部命中 |
| `followupStatus` | `overdue` / `today` / `week` / `none` | 按下次跟进日期筛选 |
| `phoneStatus` | `with` / `without` | `with`=有手机号；`without`=无手机号（排查同步异常用） |

示例：

```bash
# 无手机号的联系人（排查 App 是否把无号联系人过滤掉了）
GET /api/contacts?api_key=$KEY&phoneStatus=without&pageSize=100

# 今日待跟进，按下次跟进日期升序
GET /api/contacts?api_key=$KEY&followupStatus=today&sortBy=nextFollowupDate&sortOrder=asc
```

---

## 九、模板「当前使用」标识（v2.7.0 新增）

### 背景

之前 App 拉 `GET /api/templates` 拿不到"用户当前在用哪个模板"，只能靠猜（默认取第一个）。现在服务端**按用户隔离记录**了当前生效模板，并在列表每一项回传 `isActive`。

### 字段

`ContactTemplate` 新增可选字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `isActive` | `boolean` | 该模板是否为**当前登录用户**正在使用的模板 |

存储位置：`system_settings` 表，key = `active_template_id:<userId>`，值 = 模板 id。**按用户隔离**，A 用户选的模板不会影响 B 用户。

### 两个接口

```bash
# 1) 列表里直接带 isActive（推荐，一次请求拿全）
GET /api/templates?api_key=$KEY
# → [{ "id":"preset-real-estate", "name":"我是Davi", "isActive": true },
#    { "id":"preset-insurance",   "name":"保险顾问模板",   "isActive": false }, ...]

# 2) 单独查当前生效模板
GET /api/templates/active/current?api_key=$KEY
# → 200 { "id":"preset-real-estate", "name":"我是Davi", "isActive": true }
# → 200 null   （表示用户还没应用过任何模板）
```

### App 端推荐用法

```
list = GET /api/templates
active = list.find(t => t.isActive === true)
if (!active) active = list.find(t => t.isPreset)   // 回退：用户没选过就用第一个预设
```

### isActive 什么时候会变

- 应用模板 `POST /api/templates/:id/apply` → 该模板 `isActive` 变 true，其余全部变 false
- 删除模板 `DELETE /api/templates/:id` → 如果删的正是当前生效的，标记自动清除（下次列表全 false）
- 自定义模板和预设模板**一视同仁**，自定义模板被应用后同样是 `isActive: true`

### 注意：apply 会写标签

`apply` 会把模板自带的身份标签/属性标签**补齐写入**（已存在的同名标签跳过，不会重复建），同时覆盖 `contact_tiers` 与 `nickname_format`。
**它不会删除用户已有的标签**，但如果用户之前手改过分层和称呼格式，apply 后会被模板值覆盖——App 端如果要做"应用模板"，建议先弹二次确认。

---

## 十、模板体系升级：派生、重置、恢复出厂（v2.7.1 新增）

### 预设模板清单（2026-09-29 起生效，共 6 个）

| id | 名称 | 说明 |
|---|---|---|
| `preset-real-estate` | **我是Davi** | 原「房产经纪人模板」更名而来，内容基于 Davi 实际业务定制 |
| `preset-insurance` | 保险顾问模板 | 按客户生命周期分层（线索→已接触→高意向→已提案→已成交→续保加保） |
| `preset-ecommerce` | 微商电商模板 | 按 RFM 复购模型分层（潜在买家→首购→复购→大客户，代理分销单列） |
| `preset-social` | 自由社交模板 | 按关系深浅分层（初识→熟识→好友→核心人脉，贵人导师/待唤醒单列） |
| `preset-education` | 教育培训模板 | **新增**。按招生漏斗分层（线索→已体验→在读→已续费，转介绍/流失单列） |
| `preset-local-service` | 本地服务门店模板 | **新增**。按到店与储值分层（新客→回头客→会员→储值大客户） |

**关键设计**：所有模板的分层 value 仍是 `S/A/B/C/D/V`（App 端已按此判断，不改），但 `label` 与 `description` 变成了**行业语义**（如保险的 S=「已成交」、电商的 S=「大客户」）。App 端展示请用 `label`，逻辑判断用 `value`，**不要把 label 硬编码**。

### ContactTemplate 新增字段（可选，老数据为 null）

| 字段 | 类型 | 说明 |
|---|---|---|
| `derivedFrom` | `string \| null` | 派生来源模板 id；纯手工新建为 null |
| `baseSnapshot` | `object \| null` | 派生那一刻源模板的完整内容快照；**有此字段的方案才支持「重置」** |

### 三个新接口

```bash
# 1) 另存为新方案：预设或自定义均可复制为当前用户的新自定义方案
#    请求体可选 {"name":"自定义名称"}，缺省为「原名称 副本」
POST /api/templates/:id/duplicate
# → 201 完整模板对象（含 derivedFrom / baseSnapshot）
#    修改它不影响原模板；改崩了可一键重置

# 2) 重置：把方案内容恢复为「另存那一刻」的初始内容（baseSnapshot）
#    方案名保留（不回退为源模板名）；若该方案正在使用，contact_tiers/nickname_format 同步覆盖
POST /api/templates/:id/reset
# → 201 恢复后的模板
# → 400 该方案没有 baseSnapshot（老的自定义模板不支持重置）
# → 403 对预设模板调用

# 3) 恢复出厂：删当前用户全部自定义方案 + 清「使用中/快照」标记 + 分层与昵称重置为出厂 S/A/B/C/D/V
#    必须显式确认，防误触；不动 tags / contact_tags（联系人数据不受影响）
POST /api/templates/reset-all
Content-Type: application/json
{ "confirm": "RESET" }
# → 201 { "removedTemplates": 3 }
# → 400 缺少确认参数
```

### apply 返回体新增 applyReport

```json
{
  "id": "preset-insurance", "...": "原有模板字段全部保留",
  "applyReport": {
    "createdIdentityTags": ["企业主", "高管"],
    "createdAttributeTags": ["重疾险"],
    "skippedIdentityTags": [],
    "skippedAttributeTags": ["医疗险"]
  }
}
```

App 端解析 `apply` 响应时**兼容性无风险**：原有字段全部保留，`applyReport` 是新增键，老解析逻辑忽略即可。可用它给用户提示「本次新增了 X 个标签、跳过 Y 个同名标签」。

### 数据安全边界（实测确认）

- `duplicate` / `reset` / `reset-all` 均**按用户隔离**，只影响当前登录用户
- `reset-all` **不会**删除 `tags` / `contact_tags`——用户已打的所有标签、联系人数据原样保留（幂等实测：重置后再 apply 同模板，标签全走 skipped 不重复创建）
- apply 前服务端自动把「应用前」的 contact_tiers/nickname_format 存档到 `applied_template_snapshot:<userId>`（服务端留底，App 端无需关心）

---

## 十一、短信/通话去重 与「真实日期」要求（v2.7.2 新增）

### 11.1 短信日期显示的是备份时间，不是真实时间 —— App 端必须修

**现象**：云端短信/通话列表里，日期全部等于备份那一刻的时间，与短信真实收发时间对不上。
**根因**：App 端调同步接口时把「备份执行时刻」（如 `System.currentTimeMillis()`）填进了 `messageDate` / `callDate`，而不是从系统库里读出来的真实时间。服务端对各种格式都宽容接受，但**值本身传错了，服务端无法纠正**。

**修法（Android 示例，iOS 同理取系统库原始时间戳）**：

```kotlin
// 错误 ✗ —— 备份时刻，不是短信时间
messageDate = System.currentTimeMillis()

// 正确 ✓ —— 直接传系统库的毫秒时间戳（服务端原生接受 13 位毫秒）
messageDate = cursor.getLong(cursor.getColumnIndexOrThrow(Telephony.Sms.DATE))
callDate    = cursor.getLong(cursor.getColumnIndexOrThrow(CallLog.Calls.DATE))
```

**存量数据无法事后修复**：同一批备份的日期值相同，服务端无法反推真实时间。App 端升级后建议提供「清空云端短信/通话并重新同步」入口，让用户一次性重传（幂等键含日期，不清空直接重传会产生重复）。

### 11.2 服务端新增通讯去重（Web 端数据治理，App 端无需对接）

App 重复备份会产生完全相同的记录（幂等键含日期，日期错了就拦不住）。服务端新增两个接口供 Web 端「数据治理」使用：

| 接口 | 说明 |
|---|---|
| `GET /api/data/comm-dedup/preview` | 预览：短信按 `手机号+内容md5` 分组，通话按 `手机号+日期+方向+时长` 分组；返回组数、可删条数、样本（首末时间/内容摘要） |
| `POST /api/data/comm-dedup/execute` | 执行清理：`{"kind":"sms"}` 或 `{"kind":"calls"}`，每组只删多余、保留最早一条 |

**取舍说明**：去重只删「完全相同」的记录，不同时间的正常记录一律不动（实测：6 条含 5 条重复的短信清理后剩 3 条最早记录，异日期同型通话全部保留）。服务端**不会自动去重**——App 端防重复的根本手段仍是 11.1 的真实时间戳。

### 11.3 deviceInfo 请带上手机型号（当前只有系统版本，排查数据来源困难）

时光机批次列表里看不出数据来自哪台手机。请在同步 `start` 上传 `deviceInfo` 时按「系统版本 / 品牌+机型 / App 版本」三段拼接：

```kotlin
// Android
val deviceInfo = "Android ${Build.VERSION.RELEASE} / ${Build.MANUFACTURER} ${Build.MODEL} / App v${BuildConfig.VERSION_NAME}"
// 示例："Android 14 / Xiaomi 2304FPN6DC / App v1.8.0"
```

```swift
// iOS
let deviceInfo = "iOS \(UIDevice.current.systemVersion) / \(UIDevice.current.model) / App v\(appVersion)"
// 示例："iOS 17.5 / iPhone / App v1.8.0"（机型营销名可自选映射表）
```

服务端原样存储与展示、格式不限，但三段齐了以后，多设备用户在 Web 端一眼就能分清每批数据来自哪台手机。

---

## 十二、设备握手：启动时对齐环境与能力（v2.7.3 新增）

「同步老是对不上、传不过来」的根因往往是两边互相看不见：App 不知道云端的限制与规范变了，云端不知道 App 是什么版本什么机型。新增握手接口把这个对齐变成自动动作。

### 接口

```
POST /api/settings/sync-handshake
Content-Type: application/json

{
  "deviceId":   "App 首启生成并持久化的 UUID（SharedPreferences / Keychain，卸载重装会变）",
  "appVersion": "1.8.0",
  "osName":     "Android",              // 或 iOS
  "osVersion":  "14",
  "deviceBrand": "Xiaomi",
  "deviceModel": "2304FPN6DC",          // Build.MODEL
  "capabilities": ["chunk-upload", "real-timestamp"]
}
```

**调用时机**：App 冷启动时一次即可（幂等、轻量，服务端只做登记）。同 deviceId 重复调用会更新环境信息并累加握手计数。

### 响应（云端下发，App 应据此自查）

```json
{
  "deviceId": "test-device-001",
  "serverTime": "2026-09-29T06:11:13.965Z",     // 用于校准本地时钟偏差
  "limits": { "maxItemsPerBatch": 200, "maxBodyBytes": 716800, "maxConcurrency": 4, "maxItemChars": 2000 },
  "featureFlags": {
    "requireRealTimestamp": true,               // 必须传真实时间戳（见 11.1，这是当前最关键的开关）
    "chunkUploadSupported": true
  },
  "dateFormatsAccepted": ["2026-09-28 10:00", "1759024800000 (13 位毫秒时间戳)", "..."]
}
```

**App 端用法建议**：握手后把 `limits` / `featureFlags` 存内存，同步前自查——单批条数、体积红线、时间戳规范全部以云端下发为准，不再硬编码。

### 配套：同步事件已可观测

服务端现在会把每次分片上传的 `start` / `commit` 记入同步流水（条数、体积、耗时、成功/跳过/失败、失败原因 TOP3），
Web 端「数据 → 设备与同步健康」一屏可见：哪台设备、什么版本、卡在哪一步、被什么规则拒绝。
**再强调：App 收到 commit 响应里的 `errors[]` 时请展示给用户**，不要统一显示「服务器地址不正确」。

---

## 十三、一句话总结

**每批 500 条改成「≤200 条 且 ≤700KB，两者取小值切分」，按 UTF-8 字节数算。**
其余（时间格式、性能、幂等、截断、联系人 name/phone 必填其一、分片上传 start 冗余 received/total）服务端这轮已经全部加固，App 端不用动。

**关于你截图里的 677 条联系人失败 + 2001 条短信失败**：服务端接口已实测正常，失败原因在 App 端——请重点检查：
1. 分片上传 `start` 返回的 JSON 解析逻辑（字段类型、是否把响应当字符串嵌套）
2. 联系人批量失败时，把服务端返回的 `errors[].message` 展示出来，不要统一显示"服务器地址不正确"
3. 不要把无手机号联系人过滤掉，name 有值即可同步

有疑问直接回我，服务端这边可以配合加日志排查。
