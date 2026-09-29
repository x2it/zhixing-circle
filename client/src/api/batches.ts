import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  ImportBatch,
  ImportBatchListResponse,
  BatchDiffResponse,
  BatchRevertResponse,
  BatchRevertMultiResponse,
  BatchRemoveMultiResponse,
} from '@shared/api.interface';

export async function getBatches(): Promise<ImportBatch[]> {
  try {
    const response = await axiosForBackend.get<ImportBatchListResponse>('/api/batches');
    return response.data.items;
  } catch (error) {
    logger.error('获取批次列表失败', error);
    throw error;
  }
}

export async function deleteBatch(id: string): Promise<{ success: boolean; deletedContacts: number }> {
  try {
    const response = await axiosForBackend.delete(`/api/batches/${id}`);
    return {
      success: response.data.success,
      deletedContacts: response.data.deletedContacts ?? 0,
    };
  } catch (error) {
    logger.error('删除批次失败', error);
    throw error;
  }
}

/** 回滚预览：先看会发生什么 */
export async function getBatchDiff(id: string): Promise<BatchDiffResponse> {
  try {
    const response = await axiosForBackend.get<BatchDiffResponse>(`/api/batches/${id}/diff`);
    return response.data;
  } catch (error) {
    logger.error('获取回滚预览失败', error);
    throw error;
  }
}

/** 执行保守回滚 */
export async function revertBatch(id: string): Promise<BatchRevertResponse> {
  try {
    const response = await axiosForBackend.post<BatchRevertResponse>(`/api/batches/${id}/revert`, {});
    return response.data;
  } catch (error) {
    logger.error('回滚批次失败', error);
    throw error;
  }
}

/** 合并多个碎片批次为一个 */
export async function mergeBatches(
  sourceIds: string[],
  name?: string,
): Promise<ImportBatch> {
  const response = await axiosForBackend.post<ImportBatch>('/api/batches/merge', {
    sourceIds,
    name,
  });
  return response.data;
}

/** 批量回滚（时光机多选/全选）：逐条独立执行，单条失败不影响其余 */
/** 批量删除批次：与批量回滚对称，彻底清理选中的批次及其联系人 */
export async function removeBatchesMulti(
  ids: string[],
): Promise<BatchRemoveMultiResponse> {
  try {
    const response = await axiosForBackend.delete<BatchRemoveMultiResponse>(
      '/api/batches/batch',
      { data: { ids, confirm: 'DELETE' } },
    );
    return response.data;
  } catch (error) {
    logger.error('批量删除批次失败', error);
    throw error;
  }
}

export async function revertBatchesMulti(
  ids: string[],
): Promise<BatchRevertMultiResponse> {
  try {
    const response = await axiosForBackend.post<BatchRevertMultiResponse>(
      '/api/batches/revert-multi',
      { ids },
    );
    return response.data;
  } catch (error) {
    logger.error('批量回滚失败', error);
    throw error;
  }
}
