import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type { Request, Response, NextFunction } from 'express';
import { eq, and, gt, sql } from 'drizzle-orm';
import * as crypto from 'crypto';
import { sessions, users, apiKeys, systemSettings } from '@server/database/schema';
import { UserContext } from '@server/common/context/user-context';

/** 免鉴权白名单（精确或前缀匹配） */
const PUBLIC_PATHS: Array<{ path: string; methods?: string[] }> = [
  { path: '/api/auth/login' },
  { path: '/api/auth/recover' },
  { path: '/api/auth/status' },
  { path: '/api/health' },
  // skill 文档对外开放（只读文档，不含业务数据）
  { path: '/api/skill.md', methods: ['GET'] },
  { path: '/api/skill-md', methods: ['GET'] },
];

export const SESSION_COOKIE = 'zx_session';
/** 会话有效期：30 天 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 操作权限级别：read < write < admin */
const SCOPE_RANK: Record<string, number> = { read: 1, write: 2, admin: 3 };

/** 需要 admin 权限的高危 / 治理操作（路径含这些片段且为写方法） */
const ADMIN_OPS: Array<{ method: string; pathPart: string }> = [
  { method: 'POST', pathPart: '/api/api-keys' },
  { method: 'PUT', pathPart: '/api/api-keys/' },
  { method: 'DELETE', pathPart: '/api/api-keys/' },
  { method: 'POST', pathPart: '/contacts/merge' },
  { method: 'POST', pathPart: '/contacts/prefix-clean' },
  { method: 'POST', pathPart: '/contacts/batch-by-filter' },
  { method: 'POST', pathPart: '/batches/merge' },
  { method: 'DELETE', pathPart: '/api/data' },
  { method: 'POST', pathPart: '/api/data' },
];

/** 速率限制桶：keyId -> 最近 60s 内的请求时间戳 */
const rateBuckets = new Map<string, number[]>();

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** 把路径中的 uuid/数字段归一化为 :id，得到稳定的操作标识 */
function normalizeOp(method: string, path: string): string {
  const normalized = path
    .split('/')
    .map((seg) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ||
      /^\d+$/.test(seg)
        ? ':id'
        : seg,
    )
    .join('/');
  return `${method} ${normalized}`;
}

/** 判定该请求所需的最低权限级别 */
function requiredScope(req: Request): 'read' | 'write' | 'admin' {
  const method = req.method.toUpperCase();
  const path = req.path || '';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return 'read';
  if (ADMIN_OPS.some((o) => o.method === method && path.includes(o.pathPart))) return 'admin';
  // 带 all=true 的批量删除视为高危
  const body = req.body as Record<string, unknown> | undefined;
  if (method === 'DELETE' && body && body.all === true) return 'admin';
  return 'write';
}

/**
 * 统一鉴权中间件（替代旧 ApiKeyGuard 的"可选放行"模式）
 * - 白名单路径直接放行
 * - Authorization: Bearer zx_* → API Key 鉴权（绑定到创建该密钥的用户）
 * - cookie zx_session → 服务端会话鉴权
 * - 其余 /api/* 一律 401
 * 鉴权成功后把用户身份写入 UserContext(ALS)，service 层据此做数据隔离
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const path = req.path || req.originalUrl?.split('?')[0] || '';
    const method = req.method.toUpperCase();

    // 1. 白名单
    const isPublic = PUBLIC_PATHS.some(
      (p) =>
        (path === p.path || path.startsWith(p.path + '/')) &&
        (!p.methods || p.methods.includes(method)),
    );
    if (isPublic) {
      return next();
    }

    // 2. API Key 鉴权（多通道提取，穿透各类网关代理）
    //    支持：Authorization: Bearer zx_* / Authorization: zx_*（裸钥）
    //         X-API-Key: zx_* / ?api_key=zx_*（URL 参数兜底）
    //    注意：平台网关可能注入自己的 Authorization 头（非 zx_ 前缀），
    //    因此只有提取到 zx_ 前缀的凭证才走 API Key 分支，否则继续尝试下一通道/会话。
    const apiKeyToken = this.extractApiKeyToken(req);
    if (apiKeyToken) {
      const identity = await this.resolveApiKey(apiKeyToken);
      if (!identity) {
        return res.status(401).json({ message: 'API Key 无效或已撤销' });
      }
      // 权限与速率（仅对 API Key 生效；会话用户不受密钥权限约束）
      const permissions = await this.loadPermissions(identity.keyId);
      if (permissions.rateLimitPerMin > 0 && !this.checkRate(identity.keyId, permissions.rateLimitPerMin)) {
        return res
          .status(429)
          .set('Retry-After', '60')
          .json({ message: '请求过于频繁，已超出该密钥的速率上限' });
      }
      const denied = this.checkPermission(req, permissions);
      if (denied) {
        return res.status(403).json({ message: denied });
      }
      return UserContext.run(identity, next);
    }

    // 3. 会话 cookie 鉴权
    const cookieToken = this.readCookie(req, SESSION_COOKIE);
    if (cookieToken) {
      const identity = await this.resolveSession(cookieToken);
      if (identity) {
        return UserContext.run(identity, next);
      }
    }

    return res.status(401).json({ message: '未登录或会话已过期' });
  }

  /**
   * 多通道 API Key 提取（按优先级）：
   * 1) Authorization: Bearer zx_*   —— 标准格式（推荐）
   * 2) Authorization: zx_*          —— 裸钥（部分客户端不发 Bearer 前缀）
   * 3) X-API-Key: zx_*              —— 自定义头（网关剥离/改写 Authorization 时使用）
   * 4) ?api_key=zx_*                —— URL 参数兜底（注意勿将含密钥的 URL 写入访问日志）
   *
   * 只有 zx_ 前缀的凭证才会被采纳；网关注入的内部 token（非 zx_）会被忽略并继续尝试下一通道。
   * 返回 null 表示请求中未携带任何可识别的 API Key。
   */
  private extractApiKeyToken(req: Request): string | null {
    const candidates: string[] = [];
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.trim()) {
      const trimmed = authHeader.trim();
      if (trimmed.startsWith('Bearer ')) {
        const token = trimmed.slice(7).trim();
        if (token) candidates.push(token);
      } else {
        candidates.push(trimmed);
      }
    }
    const xApiKey = req.headers['x-api-key'];
    if (typeof xApiKey === 'string' && xApiKey.trim()) {
      candidates.push(xApiKey.trim());
    }
    const q = (req.query as Record<string, unknown>).api_key;
    if (typeof q === 'string' && q.trim()) {
      candidates.push(q.trim());
    }
    return candidates.find((t) => t.startsWith('zx_')) ?? null;
  }

  private readCookie(req: Request, name: string): string | undefined {
    const raw = req.headers.cookie;
    if (!raw) return undefined;
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=');
      if (idx > 0 && part.slice(0, idx).trim() === name) {
        return decodeURIComponent(part.slice(idx + 1).trim());
      }
    }
    return undefined;
  }

  /** 读取密钥权限配置（失败时回退为全权，避免因配置读取异常导致服务不可用） */
  private async loadPermissions(keyId: string): Promise<{
    scope: string;
    rateLimitPerMin: number;
    allowedOps?: string[];
    deniedOps?: string[];
  }> {
    try {
      const [row] = await this.db
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, `apikey_meta:${keyId}`))
        .limit(1);
      if (!row?.value) return { scope: 'admin', rateLimitPerMin: 0 };
      const parsed = JSON.parse(row.value) as {
        scope?: string;
        rateLimitPerMin?: number;
        allowedOps?: string[];
        deniedOps?: string[];
      };
      return {
        scope: parsed.scope ?? 'admin',
        rateLimitPerMin:
          typeof parsed.rateLimitPerMin === 'number' ? parsed.rateLimitPerMin : 0,
        allowedOps: Array.isArray(parsed.allowedOps) ? parsed.allowedOps : undefined,
        deniedOps: Array.isArray(parsed.deniedOps) ? parsed.deniedOps : undefined,
      };
    } catch {
      return { scope: 'admin', rateLimitPerMin: 0 };
    }
  }

  /** 速率限制：滑动 60s 窗口 */
  private checkRate(keyId: string, limit: number): boolean {
    const now = Date.now();
    const bucket = (rateBuckets.get(keyId) ?? []).filter((t) => now - t < 60_000);
    if (bucket.length >= limit) {
      rateBuckets.set(keyId, bucket);
      return false;
    }
    bucket.push(now);
    rateBuckets.set(keyId, bucket);
    // 顺带清理长期无流量的桶，避免 Map 无界增长
    if (rateBuckets.size > 5000) {
      for (const [k, v] of rateBuckets) {
        if (v.length === 0 || now - v[v.length - 1] > 300_000) rateBuckets.delete(k);
      }
    }
    return true;
  }

  /** 权限校验：返回 null 表示通过，否则返回拒绝原因 */
  private checkPermission(
    req: Request,
    permissions: { scope: string; allowedOps?: string[]; deniedOps?: string[] },
  ): string | null {
    const op = normalizeOp(req.method.toUpperCase(), req.path || '');
    const denied = permissions.deniedOps;
    if (Array.isArray(denied) && (denied.includes(op) || denied.includes('*'))) {
      return `该密钥被显式禁止此操作（${op}）`;
    }
    const need = requiredScope(req);
    const have = SCOPE_RANK[permissions.scope] ?? 3;
    if (have < SCOPE_RANK[need]) {
      return `权限不足：该操作需要 ${need} 级权限，当前密钥为 ${permissions.scope}`;
    }
    const allowed = permissions.allowedOps;
    if (Array.isArray(allowed) && allowed.length > 0) {
      if (!allowed.includes(op) && !allowed.includes('*')) {
        return `该操作不在密钥允许的操作列表内（${op}）`;
      }
    }
    return null;
  }

  private async resolveApiKey(
    plainKey: string,
  ): Promise<UserContextPayloadLike | null> {
    const keyHash = hashToken(plainKey);
    const [row] = await this.db
      .select({ id: apiKeys.id, userId: apiKeys.userId })
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.status, 'active')))
      .limit(1);
    if (!row) return null;
    // 更新 lastUsedAt：必须在请求作用域内 await（脱离作用域后连接的 RLS 角色会被回收导致静默失败）
    try {
      await this.db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, row.id));
    } catch {
      // 指标更新失败不影响鉴权
    }
    if (!row.userId) {
      // 迁移前遗留的孤儿密钥：拒绝使用（安全优先）
      return null;
    }
    const [user] = await this.db
      .select({ username: users.username, role: users.role })
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1);
    if (!user) return null;
    return {
      userId: row.userId,
      username: user.username,
      role: user.role,
      authType: 'apiKey',
      keyId: row.id,
    };
  }

  private async resolveSession(
    token: string,
  ): Promise<UserContextPayloadLike | null> {
    const tokenHash = hashToken(token);
    const [row] = await this.db
      .select({
        userId: sessions.userId,
        username: users.username,
        role: users.role,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (!row) return null;
    // 顺带清理过期会话（低频，轻量）
    if (Math.random() < 0.02) {
      void this.db.delete(sessions).where(sql`${sessions.expiresAt} < now()`);
    }
    return {
      userId: row.userId,
      username: row.username,
      role: row.role,
      authType: 'session',
    };
  }
}

interface UserContextPayloadLike {
  userId: string;
  username: string;
  role: string;
  authType: 'session' | 'apiKey';
  /** 仅 API Key 鉴权时存在，用于权限与速率控制 */
  keyId?: string;
}
