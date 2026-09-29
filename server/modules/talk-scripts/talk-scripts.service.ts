import { Inject, Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { systemSettings } from '@server/database/schema';
import { eq, like, asc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { TalkScript, CreateTalkScriptRequest, UpdateTalkScriptRequest } from '@shared/api.interface';
import { UserContext } from '@server/common/context/user-context';

const TALK_SCRIPT_KEY_PREFIX = 'talk_script:';

/** 预设话术：所有用户可见，覆盖常见跟进场景 */
const PRESET_SCRIPTS: TalkScript[] = [
  {
    id: 'preset-script-icebreak',
    title: '初次破冰',
    scene: '破冰',
    content: '{称呼}您好，我是{我的名字}。刚加了您微信，先不打扰您，后面有需要随时找我。',
    isPreset: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'preset-script-followup',
    title: '日常跟进',
    scene: '跟进',
    content: '{称呼}您好，最近{话题}有新的进展，想着跟您同步一下，方便的时候聊聊？',
    isPreset: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'preset-script-invite',
    title: '邀约见面',
    scene: '邀约',
    content: '{称呼}，这周{时间}有个不错的机会，想约您当面聊聊，您看方便吗？',
    isPreset: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'preset-script-deal',
    title: '成交推进',
    scene: '成交',
    content: '{称呼}，方案我已经按您的需求调整好了，核心的{关键点}都覆盖了，您确认下我们就往下走。',
    isPreset: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'preset-script-revisit',
    title: '售后回访',
    scene: '回访',
    content: '{称呼}，之前的事办得还顺利吗？有什么没做到位的您直接说，我来跟进。',
    isPreset: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
];

@Injectable()
export class TalkScriptsService {
  private readonly logger = new Logger(TalkScriptsService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /** 话术列表：预设 + 当前用户自定义（按用户隔离） */
  async findAll(): Promise<TalkScript[]> {
    const custom = await this.loadCustomScripts();
    return [...PRESET_SCRIPTS, ...custom];
  }

  async findOne(id: string): Promise<TalkScript> {
    const preset = PRESET_SCRIPTS.find(s => s.id === id);
    if (preset) return preset;

    const custom = await this.loadCustomScript(id);
    if (!custom) throw new NotFoundException('话术不存在');
    return custom;
  }

  async create(dto: CreateTalkScriptRequest): Promise<TalkScript> {
    if (!dto.title?.trim()) {
      throw new BadRequestException('话术标题不能为空');
    }
    if (!dto.content?.trim()) {
      throw new BadRequestException('话术内容不能为空');
    }

    const id = randomUUID();
    const nowIso = new Date().toISOString();
    const data = {
      title: dto.title.trim(),
      scene: dto.scene?.trim() ?? '',
      tier: dto.tier?.trim() || undefined,
      content: dto.content.trim(),
    };

    await this.db.insert(systemSettings).values({
      key: this.scriptKey(id),
      value: JSON.stringify(data),
    });

    return { id, isPreset: false, createdAt: nowIso, updatedAt: nowIso, ...data };
  }

  async update(id: string, dto: UpdateTalkScriptRequest): Promise<TalkScript> {
    if (PRESET_SCRIPTS.some(s => s.id === id)) {
      throw new BadRequestException('预设话术不可修改');
    }
    const existing = await this.loadCustomScript(id);
    if (!existing) throw new NotFoundException('话术不存在');

    const merged: TalkScript = {
      ...existing,
      title: dto.title?.trim() || existing.title,
      scene: dto.scene !== undefined ? dto.scene.trim() : existing.scene,
      tier: dto.tier !== undefined ? dto.tier.trim() || undefined : existing.tier,
      content: dto.content?.trim() || existing.content,
      updatedAt: new Date().toISOString(),
    };

    await this.db
      .update(systemSettings)
      .set({ value: JSON.stringify({
        title: merged.title,
        scene: merged.scene,
        tier: merged.tier,
        content: merged.content,
      }) })
      .where(eq(systemSettings.key, this.scriptKey(id)));

    return merged;
  }

  async remove(id: string): Promise<void> {
    if (PRESET_SCRIPTS.some(s => s.id === id)) {
      throw new BadRequestException('预设话术不可删除');
    }
    const result = await this.db
      .delete(systemSettings)
      .where(eq(systemSettings.key, this.scriptKey(id)))
      .returning({ key: systemSettings.key });

    if (result.length === 0) throw new NotFoundException('话术不存在');
  }

  private scriptKey(id: string): string {
    return TALK_SCRIPT_KEY_PREFIX + UserContext.getUserId() + ':' + id;
  }

  private async loadCustomScripts(): Promise<TalkScript[]> {
    const userPrefix = TALK_SCRIPT_KEY_PREFIX + UserContext.getUserId() + ':';
    const rows = await this.db
      .select()
      .from(systemSettings)
      .where(like(systemSettings.key, userPrefix + '%'))
      .orderBy(asc(systemSettings.key));

    const scripts: TalkScript[] = [];
    for (const row of rows) {
      const id = row.key.slice(userPrefix.length);
      if (!id) continue;
      try {
        const parsed = JSON.parse(row.value ?? '{}');
        scripts.push({
          id,
          title: parsed.title ?? '未命名话术',
          scene: parsed.scene ?? '',
          tier: parsed.tier || undefined,
          content: parsed.content ?? '',
          isPreset: false,
          createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
          updatedAt: row.updatedAt?.toISOString?.() ?? new Date().toISOString(),
        });
      } catch (e) {
        this.logger.warn(`Failed to parse talk script ${row.key}, deleting corrupted record`, e as Error);
        await this.db.delete(systemSettings).where(eq(systemSettings.key, row.key));
      }
    }
    return scripts;
  }

  private async loadCustomScript(id: string): Promise<TalkScript | null> {
    const key = this.scriptKey(id);
    const [row] = await this.db.select().from(systemSettings).where(eq(systemSettings.key, key));
    if (!row) return null;
    const parsed = JSON.parse(row.value ?? '{}');
    return {
      id,
      title: parsed.title ?? '未命名话术',
      scene: parsed.scene ?? '',
      tier: parsed.tier || undefined,
      content: parsed.content ?? '',
      isPreset: false,
      createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
      updatedAt: row.updatedAt?.toISOString?.() ?? new Date().toISOString(),
    };
  }
}
