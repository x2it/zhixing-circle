import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { SyncHealthResponse } from '@shared/api.interface';

export async function getSyncHealth(): Promise<SyncHealthResponse> {
  try {
    const response = await axiosForBackend.get('/api/settings/sync-health');
    return response.data;
  } catch (error) {
    logger.error('获取同步健康失败', error);
    throw error;
  }
}
