import { Injectable, Inject } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq } from 'drizzle-orm';

import { systemSettings } from '@server/database/schema';
import { UserContext } from '@server/common/context/user-context';
import type {
  MomentsCalendarItem,
  MomentsConfig,
  MomentsConfigResponse,
  MomentsCustomGroup,
  UpdateMomentsConfigRequest,
} from '@shared/api.interface';

/** 默认周历建议（用户从未编辑时下发；day 0=周一 … 6=周日） */
export const DEFAULT_CALENDAR: MomentsCalendarItem[] = [
  { day: 0, theme: '价值', content: '分享一条专业干货 / 行业洞察，建立专业形象' },
  { day: 2, theme: '专业', content: '行业动态 / 政策解读 / 知识科普' },
  { day: 4, theme: '生活', content: '日常生活 / 运动 / 美食，拉近距离' },
  { day: 6, theme: '故事', content: '成交故事 / 客户见证 / 一周心得' },
];

@Injectable()
export class MomentsService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /** 配置存储键，按用户隔离 */
  private configKey(): string {
    return `moments_config:${UserContext.getUserId()}`;
  }

  async getConfig(): Promise<MomentsConfigResponse> {
    const rows = await this.db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, this.configKey()))
      .limit(1);
    const parsed = this.parse(rows[0]?.value);
    return {
      customGroups: parsed.customGroups,
      calendar: parsed.calendar,
      calendarIsDefault: parsed.calendarIsDefault,
    };
  }

  async updateConfig(dto: UpdateMomentsConfigRequest): Promise<MomentsConfigResponse> {
    const current = await this.getConfig();
    const next: MomentsConfig = {
      customGroups: Array.isArray(dto.customGroups) ? dto.customGroups : current.customGroups,
      calendar: Array.isArray(dto.calendar) ? dto.calendar : current.calendar,
    };
    const value = JSON.stringify({
      customGroups: next.customGroups,
      // 只要 calendar 传了（哪怕是空数组），就算用户编辑过
      calendar: next.calendar,
      calendarEdited: Array.isArray(dto.calendar),
    });
    await this.db
      .insert(systemSettings)
      .values({ key: this.configKey(), value })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedAt: new Date() },
      });
    return {
      customGroups: next.customGroups,
      calendar: next.calendar,
      calendarIsDefault: !Array.isArray(dto.calendar),
    };
  }

  private parse(raw: string | null | undefined): MomentsConfig & { calendarIsDefault: boolean } {
    const empty = {
      customGroups: [] as MomentsCustomGroup[],
      calendar: DEFAULT_CALENDAR,
      calendarIsDefault: true,
    };
    if (!raw) return empty;
    try {
      const obj = JSON.parse(raw) as {
        customGroups?: MomentsCustomGroup[];
        calendar?: MomentsCalendarItem[];
        calendarEdited?: boolean;
      };
      return {
        customGroups: Array.isArray(obj.customGroups) ? obj.customGroups : [],
        calendar: Array.isArray(obj.calendar) && obj.calendar.length > 0 ? obj.calendar : DEFAULT_CALENDAR,
        calendarIsDefault: !obj.calendarEdited,
      };
    } catch {
      return empty;
    }
  }
}
