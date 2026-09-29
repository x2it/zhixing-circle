import { Controller, Get, Query, Logger } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import type { DashboardStats, TierContactGroup, Contact, Followup } from '@shared/api.interface';

@Controller('api/dashboard')
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  async getStats(@Query('batchId') batchId?: string): Promise<DashboardStats> {
    try {
      return await this.dashboardService.getStats(batchId);
    } catch (error) {
      this.logger.error('获取仪表盘统计失败', error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }

  @Get('tier-groups')
  async getTierGroups(@Query('batchId') batchId?: string): Promise<TierContactGroup[]> {
    try {
      return await this.dashboardService.getTierGroups(batchId);
    } catch (error) {
      this.logger.error('获取层级分组失败', error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }

  @Get('today-followups')
  async getTodayFollowups(@Query('batchId') batchId?: string): Promise<Contact[]> {
    try {
      return await this.dashboardService.getTodayFollowups(batchId);
    } catch (error) {
      this.logger.error('获取今日待跟进失败', error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }

  @Get('today')
  async getToday(@Query('batchId') batchId?: string): Promise<Contact[]> {
    return this.dashboardService.getTodayFollowups(batchId);
  }

  @Get('recent-activities')
  async getRecentActivities(): Promise<Array<Followup & { contactName: string }>> {
    try {
      return await this.dashboardService.getRecentActivities();
    } catch (error) {
      this.logger.error('获取最近动态失败', error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }
}
