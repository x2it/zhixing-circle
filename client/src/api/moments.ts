import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  MomentsConfigResponse,
  UpdateMomentsConfigRequest,
} from '@shared/api.interface';

export async function getMomentsConfig(): Promise<MomentsConfigResponse> {
  try {
    const response = await axiosForBackend.get('/api/moments/config');
    return response.data;
  } catch (error) {
    logger.error('获取朋友圈配置失败', error);
    throw error;
  }
}

export async function updateMomentsConfig(
  body: UpdateMomentsConfigRequest
): Promise<MomentsConfigResponse> {
  try {
    const response = await axiosForBackend.put('/api/moments/config', body);
    return response.data;
  } catch (error) {
    logger.error('保存朋友圈配置失败', error);
    throw error;
  }
}
