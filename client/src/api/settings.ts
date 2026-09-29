import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { SmsSyncSetting, CallSyncSetting } from '@shared/api.interface';

export async function getSmsSyncSetting(): Promise<SmsSyncSetting> {
  try {
    const response = await axiosForBackend.get('/api/settings/sms-sync');
    return response.data;
  } catch (error) {
    logger.error('获取短信同步开关失败', error);
    throw error;
  }
}

export async function setSmsSyncSetting(
  enabled: boolean,
): Promise<SmsSyncSetting> {
  try {
    const response = await axiosForBackend.put('/api/settings/sms-sync', {
      enabled,
    });
    return response.data;
  } catch (error) {
    logger.error('设置短信同步开关失败', error);
    throw error;
  }
}

export async function getCallSyncSetting(): Promise<CallSyncSetting> {
  try {
    const response = await axiosForBackend.get('/api/settings/call-sync');
    return response.data;
  } catch (error) {
    logger.error('获取通话同步开关失败', error);
    throw error;
  }
}

export async function setCallSyncSetting(
  enabled: boolean,
): Promise<CallSyncSetting> {
  try {
    const response = await axiosForBackend.put('/api/settings/call-sync', {
      enabled,
    });
    return response.data;
  } catch (error) {
    logger.error('设置通话同步开关失败', error);
    throw error;
  }
}
