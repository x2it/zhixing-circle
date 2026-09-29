import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  Tag,
  CreateTagRequest,
  UpdateTagRequest,
} from '@shared/api.interface';

export async function getTags(): Promise<Tag[]> {
  try {
    const response = await axiosForBackend.get('/api/tags');
    // 兼容两种响应结构: { items: [...] } 与裸数组
    const data = response.data;
    return Array.isArray(data) ? data : (data?.items ?? []);
  } catch (error) {
    logger.error('获取标签列表失败', error);
    throw error;
  }
}

export async function getTag(id: string): Promise<Tag> {
  try {
    const response = await axiosForBackend.get(`/api/tags/${id}`);
    return response.data;
  } catch (error) {
    logger.error('获取标签详情失败', error);
    throw error;
  }
}

export async function createTag(data: CreateTagRequest): Promise<Tag> {
  try {
    const response = await axiosForBackend.post('/api/tags', data);
    return response.data;
  } catch (error) {
    logger.error('创建标签失败', error);
    throw error;
  }
}

export async function updateTag(
  id: string,
  data: UpdateTagRequest,
): Promise<Tag> {
  try {
    const response = await axiosForBackend.patch(`/api/tags/${id}`, data);
    return response.data;
  } catch (error) {
    logger.error('更新标签失败', error);
    throw error;
  }
}

export async function deleteTag(id: string): Promise<void> {
  try {
    await axiosForBackend.delete(`/api/tags/${id}`);
  } catch (error) {
    logger.error('删除标签失败', error);
    throw error;
  }
}
