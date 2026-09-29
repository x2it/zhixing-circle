import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  Message,
  MessageListResponse,
  Call,
  CallListResponse,
  Conversation,
  ConversationListResponse,
  SmsSyncSetting,
  CallSyncSetting,
  SyncStatus,
} from '@shared/api.interface';

/* ===== 短信 ===== */

export async function getMessages(params: {
  page?: number;
  pageSize?: number;
  contactId?: string;
  phone?: string;
  /** 内容/号码/联系人姓名关键词 */
  keyword?: string;
  /** YYYY-MM-DD 起止（含当天） */
  dateFrom?: string;
  dateTo?: string;
  /** in=收到 out=发出 */
  direction?: string;
  /** 排序方向：desc=倒序（默认） asc=正序（按时间先后） */
  sortOrder?: string;
} = {}): Promise<MessageListResponse> {
  try {
    const response = await axiosForBackend.get('/api/messages', { params });
    return response.data;
  } catch (error) {
    logger.error('获取短信列表失败', error);
    throw error;
  }
}

export async function deleteMessage(id: string): Promise<{ success: boolean }> {
  try {
    const response = await axiosForBackend.delete(`/api/messages/${id}`);
    return response.data;
  } catch (error) {
    logger.error('删除短信失败', error);
    throw error;
  }
}

/** 短信会话列表：按号码聚合 */
export async function getConversations(params: {
  page?: number;
  pageSize?: number;
  keyword?: string;
} = {}): Promise<ConversationListResponse> {
  try {
    const response = await axiosForBackend.get('/api/messages/conversations', { params });
    return response.data;
  } catch (error) {
    logger.error('获取短信会话失败', error);
    throw error;
  }
}

/**
 * 批量删除短信：三选一
 * ids 按 id 删除 / phone 删除整个会话 / all 清空全部
 */
export async function deleteMessages(scope: {
  ids?: string[];
  phone?: string;
  all?: boolean;
}): Promise<{ deleted: number }> {
  try {
    const response = await axiosForBackend.delete('/api/messages', { data: scope });
    return response.data;
  } catch (error) {
    logger.error('批量删除短信失败', error);
    throw error;
  }
}

/* ===== 通话记录 ===== */

export async function getCalls(params: {
  page?: number;
  pageSize?: number;
  contactId?: string;
  phone?: string;
  /** 号码/联系人姓名/备注关键词 */
  keyword?: string;
  dateFrom?: string;
  dateTo?: string;
  /** in=呼入 out=呼出 missed=未接 */
  direction?: string;
  /** 通话时长下限（秒，含） */
  minDuration?: number;
  /** 通话时长上限（秒，含） */
  maxDuration?: number;
  /** 排序字段：date=通话时间（默认） duration=通话时长 */
  sortBy?: string;
  /** 排序方向：desc=倒序（默认） asc=正序 */
  sortOrder?: string;
} = {}): Promise<CallListResponse> {
  try {
    const response = await axiosForBackend.get('/api/calls', { params });
    return response.data;
  } catch (error) {
    logger.error('获取通话记录失败', error);
    throw error;
  }
}

export async function deleteCall(id: string): Promise<{ success: boolean }> {
  try {
    const response = await axiosForBackend.delete(`/api/calls/${id}`);
    return response.data;
  } catch (error) {
    logger.error('删除通话记录失败', error);
    throw error;
  }
}

export async function deleteCalls(scope: {
  ids?: string[];
  phone?: string;
  all?: boolean;
}): Promise<{ deleted: number }> {
  try {
    const response = await axiosForBackend.delete('/api/calls', { data: scope });
    return response.data;
  } catch (error) {
    logger.error('批量删除通话记录失败', error);
    throw error;
  }
}

/** 备份同步状态：开关 + 云端条数 + 最近同步时间 */
export async function getSyncStatus(): Promise<SyncStatus> {
  try {
    const response = await axiosForBackend.get('/api/settings/sync-status');
    return response.data;
  } catch (error) {
    logger.error('获取同步状态失败', error);
    throw error;
  }
}

/* ===== 同步开关 ===== */

export async function getSmsSyncSetting(): Promise<SmsSyncSetting> {
  try {
    const response = await axiosForBackend.get('/api/settings/sms-sync');
    return response.data;
  } catch (error) {
    logger.error('获取短信同步开关失败', error);
    throw error;
  }
}

export async function setSmsSyncSetting(enabled: boolean): Promise<SmsSyncSetting> {
  try {
    const response = await axiosForBackend.put('/api/settings/sms-sync', { enabled });
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

export async function setCallSyncSetting(enabled: boolean): Promise<CallSyncSetting> {
  try {
    const response = await axiosForBackend.put('/api/settings/call-sync', { enabled });
    return response.data;
  } catch (error) {
    logger.error('设置通话同步开关失败', error);
    throw error;
  }
}

export type { Message, Call, Conversation };
