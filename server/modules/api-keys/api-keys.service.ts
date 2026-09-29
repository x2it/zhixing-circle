import {
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { apiKeys, systemSettings } from '@server/database/schema';
import { eq, desc, and, inArray } from 'drizzle-orm';
import * as crypto from 'crypto';
import type {
  ApiKeyInfo,
  ApiKeyPermissions,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  ApiKeyListResponse,
  UpdateApiKeyRequest,
} from '@shared/api.interface';
import { UserContext } from '@server/common/context/user-context';

/** 权限缺省值：全权 + 不限速（历史密钥保持可用，新密钥默认也拥有账号同级能力） */
export const DEFAULT_KEY_PERMISSIONS: ApiKeyPermissions = {
  scope: 'admin',
  rateLimitPerMin: 0,
  allowedOps: [],
  deniedOps: [],
};

@Injectable()
export class ApiKeysService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  private generatePlainKey(): string {
    return 'zx_' + crypto.randomBytes(16).toString('hex');
  }

  private mapToApiKeyInfo(
    row: typeof apiKeys.$inferSelect,
    permissions?: ApiKeyPermissions,
  ): ApiKeyInfo {
    return {
      id: row.id,
      keyPrefix: row.keyPrefix,
      name: row.name ?? undefined,
      status: row.status as 'active' | 'revoked',
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : undefined,
      permissions: permissions ?? { ...DEFAULT_KEY_PERMISSIONS },
    };
  }

  /** 权限配置存放于 system_settings（避免改动 api_keys 表结构） */
  private metaKey(id: string): string {
    return `apikey_meta:${id}`;
  }

  private async readMeta(id: string): Promise<ApiKeyPermissions> {
    const [row] = await this.db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, this.metaKey(id)))
      .limit(1);
    if (!row?.value) return { ...DEFAULT_KEY_PERMISSIONS };
    try {
      const parsed = JSON.parse(row.value) as Partial<ApiKeyPermissions>;
      return {
        scope: parsed.scope ?? 'admin',
        rateLimitPerMin:
          typeof parsed.rateLimitPerMin === 'number' ? parsed.rateLimitPerMin : 0,
        allowedOps: Array.isArray(parsed.allowedOps) ? parsed.allowedOps : [],
        deniedOps: Array.isArray(parsed.deniedOps) ? parsed.deniedOps : [],
      };
    } catch {
      return { ...DEFAULT_KEY_PERMISSIONS };
    }
  }

  /** 批量读取权限配置 */
  private async readMetaMany(ids: string[]): Promise<Record<string, ApiKeyPermissions>> {
    const out: Record<string, ApiKeyPermissions> = {};
    if (ids.length === 0) return out;
    const rows = await this.db
      .select({ key: systemSettings.key, value: systemSettings.value })
      .from(systemSettings)
      .where(inArray(systemSettings.key, ids.map((id) => this.metaKey(id))));
    for (const id of ids) out[id] = { ...DEFAULT_KEY_PERMISSIONS };
    for (const r of rows) {
      const id = r.key.slice('apikey_meta:'.length);
      if (!r.value) continue;
      try {
        const parsed = JSON.parse(r.value) as Partial<ApiKeyPermissions>;
        out[id] = {
          scope: parsed.scope ?? 'admin',
          rateLimitPerMin:
            typeof parsed.rateLimitPerMin === 'number' ? parsed.rateLimitPerMin : 0,
          allowedOps: Array.isArray(parsed.allowedOps) ? parsed.allowedOps : [],
          deniedOps: Array.isArray(parsed.deniedOps) ? parsed.deniedOps : [],
        };
      } catch {
        /* 损坏的配置回退默认值 */
      }
    }
    return out;
  }

  private async writeMeta(id: string, perms: ApiKeyPermissions): Promise<void> {
    const value = JSON.stringify(perms);
    await this.db
      .insert(systemSettings)
      .values({ key: this.metaKey(id), value })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedAt: new Date() },
      });
  }

  /** 供鉴权中间件使用：读取某个密钥的权限（含速率） */
  async getPermissions(keyId: string): Promise<ApiKeyPermissions> {
    return this.readMeta(keyId);
  }

  async create(dto: CreateApiKeyRequest = {}): Promise<CreateApiKeyResponse> {
    const plainKey = this.generatePlainKey();
    const keyHash = this.hashKey(plainKey);
    const keyPrefix = plainKey.slice(0, 10);
    const userId = UserContext.getUserId();

    const [row] = await this.db
      .insert(apiKeys)
      .values({
        keyHash,
        keyPrefix,
        status: 'active',
        userId,
        name: dto.name ?? null,
      })
      .returning();

    const permissions: ApiKeyPermissions = {
      scope: dto.scope ?? 'admin',
      rateLimitPerMin: dto.rateLimitPerMin ?? 0,
      allowedOps: dto.allowedOps ?? [],
      deniedOps: dto.deniedOps ?? [],
    };
    await this.writeMeta(row.id, permissions);

    return {
      key: plainKey,
      info: this.mapToApiKeyInfo(row, permissions),
    };
  }

  /** 更新密钥的名称/权限/速率（仅限归属用户自己的密钥） */
  async update(id: string, dto: UpdateApiKeyRequest): Promise<ApiKeyInfo> {
    const userId = UserContext.getUserId();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name || null;

    const updated = await this.db
      .update(apiKeys)
      .set(patch as never)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .returning();

    if (updated.length === 0) {
      throw new NotFoundException('密钥不存在');
    }

    const current = await this.readMeta(id);
    const next: ApiKeyPermissions = {
      scope: dto.scope ?? current.scope,
      rateLimitPerMin:
        dto.rateLimitPerMin !== undefined ? dto.rateLimitPerMin : current.rateLimitPerMin,
      allowedOps: dto.allowedOps ?? current.allowedOps ?? [],
      deniedOps: dto.deniedOps ?? current.deniedOps ?? [],
    };
    await this.writeMeta(id, next);

    return this.mapToApiKeyInfo(updated[0], next);
  }

  /** 单个密钥详情（含权限） */
  async detail(id: string): Promise<ApiKeyInfo> {
    const userId = UserContext.getUserId();
    const [row] = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException('密钥不存在');
    return this.mapToApiKeyInfo(row, await this.readMeta(row.id));
  }

  async list(): Promise<ApiKeyListResponse> {
    const userId = UserContext.getUserId();
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.status, 'active'), eq(apiKeys.userId, userId)))
      .orderBy(desc(apiKeys.createdAt));

    const metas = await this.readMetaMany(rows.map((r) => r.id));

    return {
      items: rows.map((row: typeof apiKeys.$inferSelect) =>
        this.mapToApiKeyInfo(row, metas[row.id]),
      ),
    };
  }

  async reset(id: string): Promise<CreateApiKeyResponse> {
    const userId = UserContext.getUserId();
    // 撤销前先读取原权限，重置后的新密钥继承同一套权限
    const inherited = await this.readMeta(id);
    const updated = await this.db
      .update(apiKeys)
      .set({ status: 'revoked' })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .returning({ id: apiKeys.id });

    if (updated.length === 0) {
      throw new NotFoundException('密钥不存在');
    }

    return this.create({
      scope: inherited.scope,
      rateLimitPerMin: inherited.rateLimitPerMin,
      allowedOps: inherited.allowedOps,
      deniedOps: inherited.deniedOps,
    });
  }

  async revoke(id: string): Promise<void> {
    const userId = UserContext.getUserId();
    const updated = await this.db
      .update(apiKeys)
      .set({ status: 'revoked' })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .returning({ id: apiKeys.id });

    if (updated.length === 0) {
      throw new NotFoundException('密钥不存在');
    }
  }
}
