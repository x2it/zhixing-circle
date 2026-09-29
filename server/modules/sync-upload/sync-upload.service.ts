import {
  Inject,
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { systemSettings, operationLogs } from '@server/database/schema';
import { eq, and } from 'drizzle-orm';
import * as crypto from 'crypto';
import { ContactsService } from '@server/modules/contacts/contacts.service';
import { MessagesService } from '@server/modules/messages/messages.service';
import { CallsService } from '@server/modules/calls/calls.service';
import { UserContext } from '@server/common/context/user-context';
import { SYNC_LIMITS } from '@server/modules/sync-status/sync-status.service';
import type {
  SyncUploadKind,
  SyncUploadStartRequest,
  SyncUploadStartResponse,
  SyncUploadChunkRequest,
  SyncUploadChunkResponse,
  SyncUploadCommitResponse,
  SyncLimits,
  Contact,
  Message,
  Call,
  BatchCreateContactsRequest,
  BatchCreateMessagesRequest,
  BatchCreateCallsRequest,
  BatchCreateResult,
} from '@shared/api.interface';

/** 分片上传会话状态（内存） */
interface UploadSession {
  userId: string;
  kind: SyncUploadKind;
  items: unknown[];
  batchName?: string;
  deviceInfo?: string;
  total: number;
  startedAt: number;
  lastChunkAt: number;
}

/** 单片建议上限：100 条 / 300KB，留出安全余量 */
const CHUNK_SOFT_LIMIT = 100;
const CHUNK_SOFT_BYTES = 300 * 1024;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 分钟

@Injectable()
export class SyncUploadService {
  private readonly logger = new Logger('SyncUploadService');
  private readonly sessions = new Map<string, UploadSession>();

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly contactsService: ContactsService,
    private readonly messagesService: MessagesService,
    private readonly callsService: CallsService,
  ) {
    // 每 5 分钟清理过期会话
    setInterval(() => this.gc(), 5 * 60 * 1000);
  }

  /**
   * 补全设备品牌型号。
   *
   * App 上报的 deviceInfo 只有「App版本 / 系统版本」（如 "TMA 2.5.2 / Android 16"），
   * 没有品牌型号，光看批次无法判断是哪台设备同步来的。品牌型号在设备握手时
   * 已登记进 system_settings（devices:{userId}），这里取最近活跃的那台补上后缀。
   */
  private async resolveDeviceSuffix(userId: string): Promise<string> {
    try {
      const [row] = await this.db
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, `devices:${userId}`))
        .limit(1);
      if (!row?.value) return '';
      const list = JSON.parse(row.value) as Array<{
        deviceBrand?: string;
        deviceModel?: string;
        lastSeenAt?: string;
      }>;
      if (!Array.isArray(list) || list.length === 0) return '';
      // 最近活跃的那台设备，最可能就是本次同步的来源
      const latest = [...list].sort((a, b) =>
        String(b.lastSeenAt ?? '').localeCompare(String(a.lastSeenAt ?? '')),
      )[0];
      const parts = [latest?.deviceBrand, latest?.deviceModel].filter(
        (v): v is string => !!v && String(v).trim() !== '',
      );
      return parts.length > 0 ? ` · ${parts.join(' ')}` : '';
    } catch {
      // 设备注册表缺失/损坏不影响同步主流程
      return '';
    }
  }

  /** 把品牌型号后缀并入 deviceInfo，已含则跳过，避免重复拼接 */
  private withDeviceSuffix(deviceInfo: string | undefined, suffix: string): string | undefined {
    if (!suffix) return deviceInfo;
    const base = (deviceInfo ?? '').trim();
    if (base.includes(suffix.trim())) return base || undefined;
    return `${base}${suffix}`.trim() || undefined;
  }

  async start(dto: SyncUploadStartRequest): Promise<SyncUploadStartResponse> {
    if (!dto?.kind || !['contacts', 'messages', 'calls'].includes(dto.kind)) {
      throw new BadRequestException('kind 必须为 contacts / messages / calls');
    }
    const userId = UserContext.getUserId();
    const uploadId = crypto.randomUUID();
    const deviceInfo = this.withDeviceSuffix(
      dto.deviceInfo,
      await this.resolveDeviceSuffix(userId),
    );
    this.sessions.set(uploadId, {
      userId,
      kind: dto.kind,
      items: [],
      batchName: dto.batchName,
      deviceInfo,
      total: typeof dto.total === 'number' && dto.total > 0 ? dto.total : 0,
      startedAt: Date.now(),
      lastChunkAt: Date.now(),
    });
    this.logger.log(`Upload ${uploadId} started by user ${userId.slice(0, 8)}, kind=${dto.kind}`);
    // 同步事件记账：start（失败排查时可以看到「App 来过但没传完」）
    try {
      await this.db.insert(operationLogs).values({
        userId,
        action: 'sync_start',
        channel: 'app_sync',
        deviceInfo: deviceInfo ?? undefined,
        summary: {
          kind: dto.kind,
          uploadId: uploadId.slice(0, 8),
          total: typeof dto.total === 'number' && dto.total > 0 ? dto.total : 0,
          batchName: dto.batchName ?? undefined,
        },
      });
    } catch {
      // 流水记录失败不影响主流程
    }
    // 冗余 received/total 字段，兼容部分 App 客户端把 start 当 chunk 解析的场景
    return {
      uploadId,
      limits: { ...SYNC_LIMITS },
      received: 0,
      total: typeof dto.total === 'number' && dto.total > 0 ? dto.total : 0,
    };
  }

  async chunk(
    uploadId: string,
    dto: SyncUploadChunkRequest,
  ): Promise<SyncUploadChunkResponse> {
    if (!uploadId) throw new BadRequestException('uploadId 不能为空');
    const session = this.sessions.get(uploadId);
    if (!session) throw new NotFoundException('上传会话不存在或已过期');

    const userId = UserContext.getUserId();
    if (session.userId !== userId) {
      throw new ForbiddenException('无权访问该上传会话');
    }

    if (!Array.isArray(dto?.items) || dto.items.length === 0) {
      throw new BadRequestException('items 不能为空数组');
    }

    // 单片软限制：超过建议值时给警告但不拒绝，因为网关硬限在服务端控制不了
    if (dto.items.length > CHUNK_SOFT_LIMIT) {
      this.logger.warn(
        `Upload ${uploadId.slice(0, 8)} chunk items=${dto.items.length} > ${CHUNK_SOFT_LIMIT}`,
      );
    }
    const bytes = JSON.stringify(dto.items).length;
    if (bytes > CHUNK_SOFT_BYTES) {
      this.logger.warn(
        `Upload ${uploadId.slice(0, 8)} chunk bytes=${Math.round(bytes / 1024)}KB > ${CHUNK_SOFT_BYTES / 1024}KB`,
      );
    }

    session.items.push(...dto.items);
    session.lastChunkAt = Date.now();

    // 修正 total（如果客户端修正了预估数）
    if (session.total === 0 && dto.items.length > 0) {
      // 第一次上传时无法知道 total，保持 0
    }

    return { uploadId, received: session.items.length, total: session.total };
  }

  async commit(uploadId: string): Promise<SyncUploadCommitResponse<unknown>> {
    if (!uploadId) throw new BadRequestException('uploadId 不能为空');
    const session = this.sessions.get(uploadId);
    if (!session) throw new NotFoundException('上传会话不存在或已过期');

    const userId = UserContext.getUserId();
    if (session.userId !== userId) {
      throw new ForbiddenException('无权访问该上传会话');
    }

    this.logger.log(
      `Commit upload ${uploadId.slice(0, 8)} kind=${session.kind}, items=${session.items.length}`,
    );

    // 分块写入：每块不超过业务 service 的 BATCH_LIMIT，逐块调用同一套批量逻辑。
    // 分片上传的意义就是突破单次请求的体积/条数限制，所以 commit 必须分块，
    // 否则攒了 2000 条再一次性写，既会被 BATCH_LIMIT 拒绝，也会拖成超长事务。
    const WRITE_CHUNK = 200;
    const allItems: unknown[] = [];
    const allErrors: Array<{ index: number; message: string }> = [];
    let created = 0;
    let skipped = 0;
    let batchId: string | undefined;
    let batchName: string | undefined;

    try {
      for (let offset = 0; offset < session.items.length; offset += WRITE_CHUNK) {
        const slice = session.items.slice(offset, offset + WRITE_CHUNK);
        let result: BatchCreateResult<unknown>;
        if (session.kind === 'contacts') {
          result = await this.contactsService.batchCreate({
            items: slice as any,
            batchName: session.batchName,
            deviceInfo: session.deviceInfo,
            source: 'app',
          });
        } else if (session.kind === 'messages') {
          result = await this.messagesService.batchCreate({
            items: slice as any,
            batchName: session.batchName,
            deviceInfo: session.deviceInfo,
          });
        } else {
          result = await this.callsService.batchCreate({
            items: slice as any,
            batchName: session.batchName,
            deviceInfo: session.deviceInfo,
          } as any);
        }
        allItems.push(...(result.items ?? []));
        // errors 的 index 是块内下标，偏移回全局下标，方便 App 定位坏数据
        for (const e of result.errors ?? []) {
          allErrors.push({ index: offset + e.index, message: e.message });
        }
        created += result.created ?? 0;
        skipped += result.skipped ?? 0;
        batchId = (result as { batchId?: string }).batchId ?? batchId;
        batchName = (result as { batchName?: string }).batchName ?? batchName;
      }
    } finally {
      this.sessions.delete(uploadId);
    }

    this.logger.log(
      `Commit ${uploadId.slice(0, 8)} done: created=${created} skipped=${skipped} failed=${allErrors.length}`,
    );

    // 同步事件记账：commit（含成败与失败原因 TOP3，Web 端健康面板直接可见）
    try {
      await this.db.insert(operationLogs).values({
        userId,
        action: 'sync_commit',
        channel: 'app_sync',
        deviceInfo: session.deviceInfo ?? undefined,
        summary: {
          kind: session.kind,
          uploadId: uploadId.slice(0, 8),
          total: session.items.length,
          bytes: JSON.stringify(session.items).length,
          durationMs: Date.now() - session.startedAt,
          created,
          skipped,
          failed: allErrors.length,
          batchName: batchName ?? session.batchName ?? undefined,
          ...(allErrors.length > 0
            ? { errorTop: [...new Set(allErrors.map((e) => e.message))].slice(0, 3) }
            : {}),
        },
      });
    } catch {
      // 流水记录失败不影响主流程
    }

    const result: SyncUploadCommitResponse<unknown> = {
      items: allItems,
      created,
      skipped,
      uploadId,
    };
    if (allErrors.length > 0) result.errors = allErrors;
    if (batchId) result.batchId = batchId;
    if (batchName) result.batchName = batchName;
    return result;
  }

  private gc(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.lastChunkAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
        this.logger.log(`GC expired upload session ${id.slice(0, 8)}`);
      }
    }
  }
}
