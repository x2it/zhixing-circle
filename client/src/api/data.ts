import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  ExportData,
  ClearDataResponse,
  DataQualityStats,
  DedupPreviewResponse,
  DedupExecuteRequest,
  DedupExecuteResponse,
  PhoneNormalizeResult,
  TierSuggestionResponse,
  TierSuggestionApplyRequest,
  BatchTierUpdateRequest,
  BatchTagRequest,
  BatchDeleteNoPhoneResponse,
  ImportResult,
  ImportMode,
  DuplicateStrategy,
  XlsxImportRequest,
  XlsxImportResponse,
  NicknameCleanPreviewResponse,
  NicknameCleanPreviewRequest,
  NicknameCleanExecuteRequest,
  NicknameCleanExecuteResponse,
  MergeLogListResponse,
  CommDedupPreviewResponse,
  CommDedupExecuteRequest,
  CommDedupExecuteResponse,
} from '@shared/api.interface';

export async function exportAllData(params?: {
  batchId?: string;
  includeArchived?: boolean;
}): Promise<ExportData> {
  try {
    const response = await axiosForBackend.get('/api/data/export/json', {
      params,
    });
    return response.data;
  } catch (error) {
    logger.error('导出数据失败', error);
    throw error;
  }
}

export async function importAllData(data: ExportData): Promise<{
  success: boolean;
  importedContacts: number;
  importedTags: number;
  importedFollowups: number;
}> {
  try {
    const response = await axiosForBackend.post('/api/data/import/json', data);
    return {
      success: response.data.success,
      importedContacts: response.data.imported.contacts,
      importedTags: response.data.imported.tags,
      importedFollowups: response.data.imported.followups,
    };
  } catch (error) {
    logger.error('导入数据失败', error);
    throw error;
  }
}

export async function clearAllData(): Promise<ClearDataResponse> {
  try {
    const response = await axiosForBackend.post('/api/data/clear');
    return response.data;
  } catch (error) {
    logger.error('清空数据失败', error);
    throw error;
  }
}

export async function getDataQualityStats(): Promise<DataQualityStats> {
  try {
    const response = await axiosForBackend.get('/api/data/quality');
    return response.data;
  } catch (error) {
    logger.error('获取数据质量统计失败', error);
    throw error;
  }
}

export async function getDedupPreview(): Promise<DedupPreviewResponse> {
  try {
    const response = await axiosForBackend.get('/api/data/dedup/preview');
    return response.data;
  } catch (error) {
    logger.error('获取去重预览失败', error);
    throw error;
  }
}

export async function executeDedup(
  body: DedupExecuteRequest
): Promise<DedupExecuteResponse> {
  try {
    const response = await axiosForBackend.post('/api/data/dedup/execute', body);
    return response.data;
  } catch (error) {
    logger.error('执行去重失败', error);
    throw error;
  }
}

export async function normalizePhones(): Promise<PhoneNormalizeResult> {
  try {
    const response = await axiosForBackend.post('/api/data/normalize-phones');
    return response.data;
  } catch (error) {
    logger.error('手机号标准化失败', error);
    throw error;
  }
}

export async function getTierSuggestions(): Promise<TierSuggestionResponse> {
  try {
    const response = await axiosForBackend.get('/api/data/tier-suggestions');
    return response.data;
  } catch (error) {
    logger.error('获取分层建议失败', error);
    throw error;
  }
}

export async function applyTierSuggestions(
  body: TierSuggestionApplyRequest
): Promise<{ updated: number }> {
  try {
    const response = await axiosForBackend.post('/api/data/tier-suggestions/apply', body);
    return response.data;
  } catch (error) {
    logger.error('应用分层建议失败', error);
    throw error;
  }
}

export async function batchUpdateTier(
  body: BatchTierUpdateRequest
): Promise<{ updated: number }> {
  try {
    const response = await axiosForBackend.post('/api/data/batch/tier', body);
    return response.data;
  } catch (error) {
    logger.error('批量改层级失败', error);
    throw error;
  }
}

export async function batchAddTags(
  body: BatchTagRequest
): Promise<{ updated: number }> {
  try {
    const response = await axiosForBackend.post('/api/data/batch/tags', body);
    return response.data;
  } catch (error) {
    logger.error('批量打标签失败', error);
    throw error;
  }
}

export async function batchDeleteNoPhone(): Promise<BatchDeleteNoPhoneResponse> {
  try {
    const response = await axiosForBackend.post('/api/data/batch/delete-no-phone');
    return response.data;
  } catch (error) {
    logger.error('批量删除无电话联系人失败', error);
    throw error;
  }
}

export async function importWorkAppExcel(
  rows: Array<Record<string, string>>,
  mode: ImportMode,
  duplicateStrategy: DuplicateStrategy
): Promise<ImportResult> {
  try {
    const response = await axiosForBackend.post('/api/data/import/workapp-excel', {
      rows,
      mode,
      duplicateStrategy,
    });
    return response.data;
  } catch (error) {
    logger.error('导入工作APP Excel失败', error);
    throw error;
  }
}

export async function importContacts(
  contacts: Array<Record<string, string>>,
  mode: ImportMode,
  duplicateStrategy: DuplicateStrategy,
  source: string
): Promise<ImportResult> {
  try {
    const response = await axiosForBackend.post('/api/data/import/contacts', {
      contacts,
      mode,
      duplicateStrategy,
      source,
    });
    return response.data;
  } catch (error) {
    logger.error('导入联系人失败', error);
    throw error;
  }
}

export async function exportWorkAppExcel(): Promise<Blob> {
  try {
    const response = await axiosForBackend.get('/api/data/export/workapp-excel', {
      responseType: 'blob',
    });
    return response.data;
  } catch (error) {
    logger.error('导出工作APP Excel失败', error);
    throw error;
  }
}

export async function exportContactsVcf(): Promise<Blob> {
  try {
    const response = await axiosForBackend.get('/api/data/export/vcf', {
      responseType: 'blob',
    });
    return response.data;
  } catch (error) {
    logger.error('导出 vCard 失败', error);
    throw error;
  }
}

export async function exportContactsCsvDownload(): Promise<Blob> {
  try {
    const response = await axiosForBackend.get('/api/data/export/csv', {
      responseType: 'blob',
    });
    return response.data;
  } catch (error) {
    logger.error('导出 CSV 失败', error);
    throw error;
  }
}

/**
 * 导出联系人为 CSV（客户端生成）
 */
export async function exportContactsCsv(params?: {
  batchId?: string;
  includeArchived?: boolean;
}): Promise<string> {
  try {
    const response = await axiosForBackend.get('/api/data/export/csv', {
      params,
      responseType: 'text',
    });
    return response.data;
  } catch (error) {
    logger.error('导出 CSV 失败', error);
    throw error;
  }
}

export async function getNicknameCleanPreview(
  body: NicknameCleanPreviewRequest
): Promise<NicknameCleanPreviewResponse> {
  try {
    const response = await axiosForBackend.post('/api/data/nickname/clean/preview', body);
    return response.data;
  } catch (error) {
    logger.error('获取备注名清洗预览失败', error);
    throw error;
  }
}

export async function executeNicknameClean(
  body: NicknameCleanExecuteRequest
): Promise<NicknameCleanExecuteResponse> {
  try {
    const response = await axiosForBackend.post('/api/data/nickname/clean/execute', body);
    return response.data;
  } catch (error) {
    logger.error('执行备注名清洗失败', error);
    throw error;
  }
}

export async function importXlsx(
  body: XlsxImportRequest
): Promise<XlsxImportResponse> {
  try {
    const response = await axiosForBackend.post('/api/data/import/xlsx', body);
    return response.data;
  } catch (error) {
    logger.error('XLSX 导入失败', error);
    throw error;
  }
}

export async function getMergeLogs(params?: {
  page?: number;
  pageSize?: number;
  contactId?: string;
}): Promise<MergeLogListResponse> {
  try {
    const response = await axiosForBackend.get('/api/data/merge-logs', { params });
    return response.data;
  } catch (error) {
    logger.error('获取合并记录失败', error);
    throw error;
  }
}

export async function seedExamples(): Promise<{ created: number }> {
  try {
    const response = await axiosForBackend.post('/api/data/seed-examples');
    return response.data;
  } catch (error) {
    logger.error('生成示例数据失败', error);
    throw error;
  }
}

export async function getCommDedupPreview(): Promise<CommDedupPreviewResponse> {
  try {
    const response = await axiosForBackend.get('/api/data/comm-dedup/preview');
    return response.data;
  } catch (error) {
    logger.error('获取通讯去重预览失败', error);
    throw error;
  }
}

export async function executeCommDedup(
  body: CommDedupExecuteRequest
): Promise<CommDedupExecuteResponse> {
  try {
    const response = await axiosForBackend.post('/api/data/comm-dedup/execute', body);
    return response.data;
  } catch (error) {
    logger.error('执行通讯去重失败', error);
    throw error;
  }
}

