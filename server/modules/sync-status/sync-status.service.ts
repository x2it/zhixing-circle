import { Inject, Injectable, BadRequestException, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { messages, calls, systemSettings, operationLogs } from '@server/database/schema';
import { eq, and, count, sql, desc, inArray } from 'drizzle-orm';
import type {
  SyncStatus,
  SyncLimits,
  DeviceHandshakeRequest,
  DeviceHandshakeResponse,
  DeviceInfoItem,
  SyncEventItem,
  SyncHealthResponse,
} from '@shared/api.interface';
import { UserContext } from '@server/common/context/user-context';

const SMS_SYNC_KEY = 'sms_sync_enabled';
const CALL_SYNC_KEY = 'call_sync_enabled';

/**
 * 同步分片上限（云端权威，App 启动时从 /api/settings/sync-status 读取）。
 *
 * 背景：平台网关对单个请求体有 1MB 硬上限，超出后请求根本到不了应用层，
 * 网关直接返回 500，App 侧表现为「同步失败 / 服务器地址不正确或接口未开放」。
 * 历史上 App 按 500 条/批同步，长短信 + emoji 场景极易突破 1MB。
 *
 * 对策：单批条数降到 200，并对单条内容做 2000 字符截断，
 * 使一批的 JSON 体积稳定落在 ~150KB，远低于 1MB 红线。
 */
export const SYNC_LIMITS: SyncLimits = {
  maxItemsPerBatch: 200,
  maxBodyBytes: 700 * 1024,
  hardBodyBytes: 1024 * 1024,
  maxConcurrency: 4,
  maxItemChars: 2000,
  note: '单批条数与请求体体积取小值切分；超过 1MB 会被网关直接拒绝（HTTP 500）',
};

/**
 * 备份同步状态：开关 + 云端条数 + 最近同步时间。
 * 刻意不受「同步开关」限制——关着的时候也要能看到云端到底有多少数据，
 * 否则用户无法判断 App 的备份是否真的同步成功。
 */
@Injectable()
export class SyncStatusService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async getStatus(): Promise<SyncStatus> {
    const userId = UserContext.getUserId();

    const [smsSetting, callSetting] = await Promise.all([
      this.readFlag(`${SMS_SYNC_KEY}:${userId}`),
      this.readFlag(`${CALL_SYNC_KEY}:${userId}`),
    ]);

    const [smsAgg] = await this.db
      .select({ total: count(), lastAt: sql<string | null>`MAX(${messages.createdAt})` })
      .from(messages)
      .where(eq(messages.userId, userId));

    const [callAgg] = await this.db
      .select({ total: count(), lastAt: sql<string | null>`MAX(${calls.createdAt})` })
      .from(calls)
      .where(eq(calls.userId, userId));

    return {
      smsSyncEnabled: smsSetting,
      callSyncEnabled: callSetting,
      smsTotal: Number(smsAgg?.total ?? 0),
      callTotal: Number(callAgg?.total ?? 0),
      lastSmsSyncAt: this.toIso(smsAgg?.lastAt),
      lastCallSyncAt: this.toIso(callAgg?.lastAt),
      limits: { ...SYNC_LIMITS },
    };
  }

  private async readFlag(key: string): Promise<boolean> {
    const [row] = await this.db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(and(eq(systemSettings.key, key)))
      .limit(1);
    return row?.value === 'true';
  }

  // ===== 设备握手与同步健康 =====

  private readonly logger = new Logger('SyncStatusService');

  /** 服务端接受的时间格式样例（下发供 App 自查） */
  private static readonly DATE_FORMATS_ACCEPTED = [
    '2026-09-28 10:00',
    '2026-09-28 10:00:00',
    '2026-09-28T10:00:00+08:00',
    '2026-09-28T10:00:00Z',
    '1759024800000 (13 位毫秒时间戳)',
    '1759024800 (10 位秒级时间戳)',
  ];

  private devicesKey(): string {
    return `devices:${UserContext.getUserId()}`;
  }

  /**
   * 设备握手：App 启动时上报环境/能力，云端登记并下发限制与特性开关。
   * 设备注册表存 system_settings（devices:{userId}），零迁移。
   */
  async handshake(dto: DeviceHandshakeRequest): Promise<DeviceHandshakeResponse> {
    const deviceId = (dto?.deviceId ?? '').trim();
    if (!deviceId || deviceId.length > 100) {
      throw new BadRequestException('deviceId 必填且不超过 100 字符');
    }
    const userId = UserContext.getUserId();
    const now = new Date().toISOString();

    const devices = await this.readDevices();
    const idx = devices.findIndex((d) => d.deviceId === deviceId);
    if (idx >= 0) {
      const d = devices[idx];
      devices[idx] = {
        ...d,
        appVersion: dto.appVersion ?? d.appVersion,
        osName: dto.osName ?? d.osName,
        osVersion: dto.osVersion ?? d.osVersion,
        deviceBrand: dto.deviceBrand ?? d.deviceBrand,
        deviceModel: dto.deviceModel ?? d.deviceModel,
        capabilities: Array.isArray(dto.capabilities) ? dto.capabilities : d.capabilities,
        lastSeenAt: now,
        handshakeCount: d.handshakeCount + 1,
      };
    } else {
      devices.push({
        deviceId,
        appVersion: dto.appVersion,
        osName: dto.osName,
        osVersion: dto.osVersion,
        deviceBrand: dto.deviceBrand,
        deviceModel: dto.deviceModel,
        capabilities: Array.isArray(dto.capabilities) ? dto.capabilities : [],
        firstSeenAt: now,
        lastSeenAt: now,
        handshakeCount: 1,
      });
      // 上限保护：只保留最近 20 台设备
      if (devices.length > 20) devices.splice(0, devices.length - 20);
    }
    await this.writeDevices(devices);
    this.logger.log(`Handshake from ${deviceId.slice(0, 12)} (${dto.osName ?? '?'} ${dto.deviceModel ?? ''}) user ${userId.slice(0, 8)}`);

    return {
      deviceId,
      serverTime: now,
      limits: { ...SYNC_LIMITS },
      featureFlags: {
        requireRealTimestamp: true,
        chunkUploadSupported: true,
      },
      dateFormatsAccepted: SyncStatusService.DATE_FORMATS_ACCEPTED,
    };
  }

  /** 设备与同步健康：注册表 + 最近同步事件（operation_logs）+ 失败统计 */
  async getSyncHealth(): Promise<SyncHealthResponse> {
    const userId = UserContext.getUserId();
    const devices = await this.readDevices();

    const eventRows = await this.db
      .select({
        id: operationLogs.id,
        action: operationLogs.action,
        summary: operationLogs.summary,
        deviceInfo: operationLogs.deviceInfo,
        createdAt: operationLogs.createdAt,
      })
      .from(operationLogs)
      .where(
        and(
          eq(operationLogs.userId, userId),
          inArray(operationLogs.action, ['sync_start', 'sync_commit']),
        ),
      )
      .orderBy(desc(operationLogs.createdAt))
      .limit(50);

    const [totalRow] = await this.db
      .select({ total: count() })
      .from(operationLogs)
      .where(
        and(
          eq(operationLogs.userId, userId),
          inArray(operationLogs.action, ['sync_start', 'sync_commit']),
        ),
      );

    const recentEvents: SyncEventItem[] = eventRows.map((r) => ({
      id: r.id,
      action: r.action,
      kind: (r.summary as { kind?: string })?.kind,
      deviceInfo: r.deviceInfo ?? undefined,
      summary: (r.summary as Record<string, unknown>) ?? {},
      createdAt: this.toIso(r.createdAt) ?? '',
    }));

    // 近 30 天有失败条目的 commit
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const failedRows = await this.db
      .select({
        summary: operationLogs.summary,
        createdAt: operationLogs.createdAt,
      })
      .from(operationLogs)
      .where(
        and(
          eq(operationLogs.userId, userId),
          eq(operationLogs.action, 'sync_commit'),
          sql`${operationLogs.createdAt} > ${since.toISOString()}`,
          sql`COALESCE((${operationLogs.summary}::jsonb ->> 'failed')::int, 0) > 0`,
        ),
      )
      .orderBy(desc(operationLogs.createdAt))
      .limit(200);

    const lastFailed = failedRows[0];
    return {
      devices,
      recentEvents,
      stats: {
        totalEvents: Number(totalRow?.total ?? 0),
        failedCommits: failedRows.length,
        lastErrorAt: lastFailed ? this.toIso(lastFailed.createdAt) : null,
        lastErrorMessage:
          (lastFailed?.summary as { errorTop?: string[] })?.errorTop?.[0] ?? null,
      },
    };
  }

  private async readDevices(): Promise<DeviceInfoItem[]> {
    try {
      const [row] = await this.db
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, this.devicesKey()))
        .limit(1);
      const parsed = row?.value ? (JSON.parse(row.value) as DeviceInfoItem[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async writeDevices(devices: DeviceInfoItem[]): Promise<void> {
    const value = JSON.stringify(devices);
    await this.db
      .insert(systemSettings)
      .values({ key: this.devicesKey(), value })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedAt: new Date() },
      });
  }

  private toIso(value: string | Date | null | undefined): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
}
