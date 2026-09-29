/**
 * 同步上报的入参归一化工具。
 *
 * 背景：App 端（Android/iOS）上报的时间、方向等字段格式与云端历史约定常有出入
 * （例如时间带秒 `2026-09-28 10:00:00`、ISO `2026-09-28T10:00:00+08:00`、毫秒时间戳，
 * 方向写成 `incoming`/`OUT`/`1`）。云端此前用严格正则校验，不匹配就整条丢弃，
 * 表现为 App 侧「同步 N 条失败」但服务端看不出任何异常。
 *
 * 这里统一做宽容归一化：能救回来的尽量救，实在救不回的才进 errors。
 */

/** 单条文本字段的最大字符数：超出截断，避免单条内容撑爆整批请求体（网关 1MB 硬限） */
export const SYNC_ITEM_MAX_CHARS = 2000;

const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 把任意常见时间表示归一化为云端统一存储格式 `YYYY-MM-DD HH:mm`。
 * 无法识别时返回 null（调用方据此记入 errors）。
 *
 * - 无时区信息的 `YYYY-MM-DD HH:mm[:ss]`：按字面取值，不做时区换算（App 上报的是本机时间）
 * - 带时区 / ISO8601：解析后按服务端本地时区格式化
 * - 数字：视为毫秒时间戳
 */
export function normalizeSyncDateTime(input: unknown): string | null {
  if (input == null) return null;

  // 时间戳（毫秒）。小于 1e11 视为秒级时间戳（10 位），需 ×1000，
  // 否则 new Date(1759000000) 会落到 1970 年。
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) return null;
    const ms = input < 1e11 ? input * 1000 : input;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return `${input.getFullYear()}-${pad(input.getMonth() + 1)}-${pad(input.getDate())} ${pad(input.getHours())}:${pad(input.getMinutes())}`;
  }

  if (typeof input !== 'string') return null;

  const raw = input.trim();
  if (!raw) return null;

  // 纯数字字符串：毫秒时间戳（13 位）或秒级时间戳（10 位）
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = raw.length <= 10 ? n * 1000 : n;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // 无时区信息：按字面取值，只截取到分钟
  const m = DATE_TIME_RE.exec(raw);
  if (m) {
    const [, y, mo, d, h, mi] = m;
    return `${y}-${mo}-${d} ${h}:${mi}`;
  }

  // 其它可被 Date 解析的格式（含时区）走兜底
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
  }

  return null;
}

/**
 * 归一化通话方向。
 * 入呼：in / incoming / in / 1 / 已接 / 呼入
 * 外呼：out / outgoing / 2 / 呼出
 * 无法识别时返回 null。
 */
export function normalizeDirection(input: unknown): 'in' | 'out' | null {
  if (input == null) return null;
  if (typeof input === 'number') {
    if (input === 1) return 'in';
    if (input === 2) return 'out';
    return null;
  }
  if (typeof input !== 'string') return null;
  const v = input.trim().toLowerCase();
  if (!v) return null;
  if (['in', 'incoming', 'inbound', 'receive', 'received', '1', '呼入', '已接', '接听', '来电'].includes(v)) {
    return 'in';
  }
  if (['out', 'outgoing', 'outbound', 'send', 'sent', 'dial', 'dialed', '2', '呼出', '已拨', '拨打', '去电'].includes(v)) {
    return 'out';
  }
  return null;
}

/**
 * 短信方向归一化：额外兼容 Android Telephony 的消息类型常量
 * （1=收件箱 2=已发送，另有草稿/发件箱等，这里只取 in/out 两类有效值）。
 */
export function normalizeMessageDirection(input: unknown): 'in' | 'out' | null {
  const base = normalizeDirection(input);
  if (base) return base;
  if (typeof input === 'string') {
    const v = input.trim().toLowerCase();
    // Android: MESSAGE_TYPE_INBOX=1 / MESSAGE_TYPE_SENT=2；这里字符串形态可能是 "1"/"2"
    if (v === '1') return 'in';
    if (v === '2') return 'out';
  }
  return null;
}

/**
 * 通话方向归一化（比短信多一个 missed 未接）。
 * 兼容 incoming / missed_call / 未接 / 3 等 App 端写法。
 */
export function normalizeCallDirection(input: unknown): 'in' | 'out' | 'missed' | null {
  if (input == null) return null;
  const base = normalizeDirection(input);
  if (base) return base;
  const raw = typeof input === 'string' ? input.trim().toLowerCase() : String(input).trim().toLowerCase();
  if (['missed', 'missed_call', 'misscall', 'no_answer', 'rejected', 'unanswered', '3', '未接', '未接来电', '拒接', '挂断'].includes(raw)) {
    return 'missed';
  }
  return null;
}

/**
 * 通话时长归一化（秒）。
 * 兼容：120 / "120" / "120s" / "2:00" / "02:00" / "2分" 等写法。
 * 非法或超出 0~86400 返回 null（调用方记入 errors，不做静默钳制以免掩盖数据问题）。
 */
export function normalizeDuration(input: unknown): number | null {
  if (input == null || input === '') return 0;
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0 || input > 86400) return null;
    return Math.round(input);
  }
  if (typeof input !== 'string') return null;
  const raw = input.trim().toLowerCase();
  if (!raw) return 0;

  // mm:ss 或 hh:mm:ss
  const colon = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(raw);
  if (colon) {
    const [, a, b, c] = colon;
    const sec = c === undefined ? Number(a) * 60 + Number(b) : Number(a) * 3600 + Number(b) * 60 + Number(c);
    if (!Number.isFinite(sec) || sec < 0 || sec > 86400) return null;
    return Math.round(sec);
  }

  const num = Number(raw.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(num) || num < 0 || num > 86400) return null;
  return Math.round(num);
}

/** 文本截断（防单条撑爆整批请求体） */
export function truncateText(input: unknown, max = SYNC_ITEM_MAX_CHARS): string {
  const s = typeof input === 'string' ? input : input == null ? '' : String(input);
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * 号码清洗：仅去掉空白字符。
 * 刻意不做「去掉 -/()/+86」这类激进归一化——幂等去重键是 phone+时间+内容，
 * 一旦号码被改写，已入库的历史数据就匹配不上，重试会造成整批重复插入。
 */
export function normalizePhone(input: unknown): string {
  const s = typeof input === 'string' ? input : input == null ? '' : String(input);
  return s.replace(/\s+/g, '');
}
