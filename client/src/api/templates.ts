import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type { ContactTemplate, CreateTemplateRequest } from '@shared/api.interface';

export async function getTemplates(): Promise<ContactTemplate[]> {
  const response = await axiosForBackend.get('/api/templates');
  return response.data;
}

export async function getTemplate(id: string): Promise<ContactTemplate> {
  const response = await axiosForBackend.get(`/api/templates/${id}`);
  return response.data;
}

export async function createTemplate(
  template: CreateTemplateRequest,
): Promise<ContactTemplate> {
  const response = await axiosForBackend.post('/api/templates', template);
  return response.data;
}

export async function updateTemplate(
  id: string,
  template: Partial<ContactTemplate>,
): Promise<ContactTemplate> {
  const response = await axiosForBackend.put(`/api/templates/${id}`, template);
  return response.data;
}

export async function deleteTemplate(id: string): Promise<{ success: boolean }> {
  const response = await axiosForBackend.delete(`/api/templates/${id}`);
  return response.data;
}

export async function applyTemplate(id: string): Promise<ContactTemplate> {
  const response = await axiosForBackend.post(`/api/templates/${id}/apply`);
  return response.data;
}

/** 另存为新方案：预设或自定义均可复制为当前用户的新自定义方案（记录派生来源，可随时重置） */
export async function duplicateTemplate(id: string, name?: string): Promise<ContactTemplate> {
  const response = await axiosForBackend.post(`/api/templates/${id}/duplicate`, {
    name: name?.trim() || undefined,
  });
  return response.data;
}

/** 重置自定义方案：恢复为「另存那一刻」的初始内容 */
export async function resetTemplate(id: string): Promise<ContactTemplate> {
  const response = await axiosForBackend.post(`/api/templates/${id}/reset`);
  return response.data;
}

/** 恢复出厂：删除当前用户全部自定义方案，并把分层/昵称配置重置为出厂值 */
export async function resetAllTemplates(): Promise<{ removedTemplates: number }> {
  const response = await axiosForBackend.post('/api/templates/reset-all', { confirm: 'RESET' });
  return response.data;
}

export async function getPresets(): Promise<ContactTemplate[]> {
  const response = await axiosForBackend.get('/api/templates/presets/list');
  return response.data;
}

/** 当前正在使用的模板；从未应用过任何模板时返回 null */
export async function getActiveTemplate(): Promise<ContactTemplate | null> {
  try {
    const response = await axiosForBackend.get('/api/templates/active/current');
    return response.data ?? null;
  } catch (error) {
    logger.error('获取当前使用模板失败', error);
    throw error;
  }
}
