import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  DashboardStats,
  TierContactGroup,
  Contact,
  DashboardActivity,
} from '@shared/api.interface';

export async function getDashboardStats(batchId?: string): Promise<DashboardStats> {
  try {
    const response = await axiosForBackend.get('/api/dashboard/stats', {
      params: batchId ? { batchId } : undefined,
    });
    return response.data;
  } catch (error) {
    logger.error('获取仪表盘统计失败', error);
    throw error;
  }
}

export async function getTierGroups(batchId?: string): Promise<TierContactGroup[]> {
  try {
    const response = await axiosForBackend.get('/api/dashboard/tier-groups', {
      params: batchId ? { batchId } : undefined,
    });
    return response.data;
  } catch (error) {
    logger.error('获取层级分组失败', error);
    throw error;
  }
}

export async function getTodayFollowups(batchId?: string): Promise<Contact[]> {
  try {
    const response = await axiosForBackend.get('/api/dashboard/today-followups', {
      params: batchId ? { batchId } : undefined,
    });
    return response.data;
  } catch (error) {
    logger.error('获取今日待跟进失败', error);
    throw error;
  }
}

export async function getRecentActivities(): Promise<DashboardActivity[]> {
  try {
    const response = await axiosForBackend.get('/api/dashboard/recent-activities');
    return response.data;
  } catch (error) {
    logger.error('获取最近跟进动态失败', error);
    throw error;
  }
}
