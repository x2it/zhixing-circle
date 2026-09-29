import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  ApiKeyInfo,
  ApiKeyListResponse,
  CreateApiKeyResponse,
  CreateApiKeyRequest,
  UpdateApiKeyRequest,
} from '@shared/api.interface';

export async function listKeys(): Promise<ApiKeyInfo[]> {
  try {
    const response = await axiosForBackend.get<ApiKeyListResponse>(
      '/api/api-keys'
    );
    return response.data.items;
  } catch (error) {
    logger.error('获取 API 密钥列表失败', error);
    throw error;
  }
}

/** 生成密钥：可指定名称、权限级别、速率上限、允许/禁止的操作 */
export async function createKey(
  payload?: CreateApiKeyRequest
): Promise<CreateApiKeyResponse> {
  try {
    const response = await axiosForBackend.post<CreateApiKeyResponse>(
      '/api/api-keys',
      payload ?? {}
    );
    return response.data;
  } catch (error) {
    logger.error('生成 API 密钥失败', error);
    throw error;
  }
}

/** 更新密钥（名称 / 权限级别 / 速率 / 操作白黑名单） */
export async function updateKey(
  id: string,
  payload: UpdateApiKeyRequest
): Promise<ApiKeyInfo> {
  try {
    const response = await axiosForBackend.put<ApiKeyInfo>(
      `/api/api-keys/${id}`,
      payload
    );
    return response.data;
  } catch (error) {
    logger.error('更新 API 密钥失败', error);
    throw error;
  }
}

/** 密钥详情（含权限配置） */
export async function getKey(id: string): Promise<ApiKeyInfo> {
  try {
    const response = await axiosForBackend.get<ApiKeyInfo>(
      `/api/api-keys/${id}`
    );
    return response.data;
  } catch (error) {
    logger.error('获取 API 密钥详情失败', error);
    throw error;
  }
}

export async function resetKey(id: string): Promise<CreateApiKeyResponse> {
  try {
    const response = await axiosForBackend.post<CreateApiKeyResponse>(
      `/api/api-keys/${id}/reset`
    );
    return response.data;
  } catch (error) {
    logger.error('重置 API 密钥失败', error);
    throw error;
  }
}

export async function revokeKey(id: string): Promise<{ success: boolean }> {
  try {
    const response = await axiosForBackend.delete(`/api/api-keys/${id}`);
    return response.data;
  } catch (error) {
    logger.error('撤销 API 密钥失败', error);
    throw error;
  }
}
