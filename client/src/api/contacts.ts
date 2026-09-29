import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  Contact,
  ContactListQuery,
  ContactListResponse,
  CreateContactRequest,
  UpdateContactRequest,
  BatchArchiveRequest,
  MergeLogListResponse,
  ContactFilter,
  BatchByFilterResponse,
  PrefixStat,
  PrefixCleanResponse,
  DuplicateGroup,
  MergeContactsResponse,
} from '@shared/api.interface';

export async function getContacts(
  params: ContactListQuery = {},
): Promise<ContactListResponse> {
  try {
    const { tagIds, ...rest } = params;
    const query: Record<string, unknown> = { ...rest };
    if (tagIds && tagIds.length > 0) {
      query.tagIds = tagIds.join(',');
    }
    const response = await axiosForBackend.get('/api/contacts', { params: query });
    return response.data;
  } catch (error) {
    logger.error('获取联系人列表失败', error);
    throw error;
  }
}

export async function getContact(id: string): Promise<Contact> {
  try {
    const response = await axiosForBackend.get(`/api/contacts/${id}`);
    return response.data;
  } catch (error) {
    logger.error('获取联系人详情失败', error);
    throw error;
  }
}

export async function createContact(
  data: CreateContactRequest,
): Promise<Contact> {
  try {
    const response = await axiosForBackend.post('/api/contacts', data);
    return response.data;
  } catch (error) {
    logger.error('创建联系人失败', error);
    throw error;
  }
}

export async function updateContact(
  id: string,
  data: UpdateContactRequest,
): Promise<Contact> {
  try {
    const response = await axiosForBackend.patch(`/api/contacts/${id}`, data);
    return response.data;
  } catch (error) {
    logger.error('更新联系人失败', error);
    throw error;
  }
}

export async function deleteContact(id: string): Promise<void> {
  try {
    await axiosForBackend.delete(`/api/contacts/${id}`);
  } catch (error) {
    logger.error('删除联系人失败', error);
    throw error;
  }
}

export async function getContactMergeLogs(
  contactId: string,
): Promise<MergeLogListResponse> {
  try {
    const response = await axiosForBackend.get(`/api/contacts/${contactId}/merge-logs`);
    return response.data;
  } catch (error) {
    logger.error('获取联系人合并记录失败', error);
    throw error;
  }
}

export async function batchArchive(
  contactIds: string[],
  archived: boolean,
): Promise<{ updated: number }> {
  try {
    const body: BatchArchiveRequest = { contactIds, archived };
    const response = await axiosForBackend.post('/api/contacts/batch-archive', body);
    return response.data;
  } catch (error) {
    logger.error('批量归档失败', error);
    throw error;
  }
}

/** 按筛选条件批量操作（跨页批量：作用于筛选命中的全部联系人） */
export async function batchByFilter(
  filter: ContactFilter,
  action: 'archive' | 'unarchive' | 'addTags',
  tagIds?: string[],
): Promise<BatchByFilterResponse> {
  const response = await axiosForBackend.post<BatchByFilterResponse>('/api/contacts/batch-by-filter', {
    filter,
    action,
    tagIds,
  });
  return response.data;
}

/** 名称前缀分析（智能识别，人工确认后再执行） */
export async function analyzePrefixes(): Promise<PrefixStat[]> {
  const response = await axiosForBackend.get<PrefixStat[]>('/api/contacts/prefix-analysis');
  return response.data;
}

export async function cleanPrefix(
  prefix: string,
  mode: 'strip' | 'tag',
  tagName?: string,
  dryRun?: boolean,
): Promise<PrefixCleanResponse> {
  const response = await axiosForBackend.post<PrefixCleanResponse>('/api/contacts/prefix-clean', {
    prefix,
    mode,
    tagName,
    dryRun,
  });
  return response.data;
}

/** 重复候选检测（只识别，不自动合并） */
export async function findDuplicates(): Promise<DuplicateGroup[]> {
  const response = await axiosForBackend.get<DuplicateGroup[]>('/api/contacts/duplicates');
  return response.data;
}

/** 确认式合并（用户勾选后才提交，服务端写合并日志可追溯） */
export async function mergeContacts(
  groups: Array<{ keepId: string; mergeIds: string[] }>,
): Promise<MergeContactsResponse> {
  const response = await axiosForBackend.post<MergeContactsResponse>('/api/contacts/merge', { groups });
  return response.data;
}
