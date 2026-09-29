import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  Followup,
  CreateFollowupRequest,
} from '@shared/api.interface';

export async function getFollowupsByContact(
  contactId: string,
): Promise<Followup[]> {
  try {
    const response = await axiosForBackend.get(
      `/api/contacts/${contactId}/followups`,
    );
    return response.data;
  } catch (error) {
    logger.error('获取跟进记录失败', error);
    throw error;
  }
}

export async function createFollowup(
  data: CreateFollowupRequest,
): Promise<Followup> {
  try {
    const response = await axiosForBackend.post('/api/followups', data);
    return response.data;
  } catch (error) {
    logger.error('创建跟进记录失败', error);
    throw error;
  }
}

export async function updateFollowup(
  id: string,
  data: Partial<CreateFollowupRequest>,
): Promise<Followup> {
  try {
    const response = await axiosForBackend.patch(
      `/api/followups/${id}`,
      data,
    );
    return response.data;
  } catch (error) {
    logger.error('更新跟进记录失败', error);
    throw error;
  }
}

export async function deleteFollowup(id: string): Promise<void> {
  try {
    await axiosForBackend.delete(`/api/followups/${id}`);
  } catch (error) {
    logger.error('删除跟进记录失败', error);
    throw error;
  }
}
