import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  LoginRequest,
  LoginResponse,
  AuthStatusResponse,
  UserInfo,
  RecoveryCodesStatus,
  RecoveryCodesRegenerateResponse,
} from '@shared/api.interface';

export async function login(username: string, password: string): Promise<LoginResponse> {
  try {
    const data: LoginRequest = { username, password };
    const response = await axiosForBackend.post('/api/auth/login', data);
    return response.data;
  } catch (error) {
    logger.error('登录失败', error);
    throw error;
  }
}

export async function logout(): Promise<void> {
  try {
    await axiosForBackend.post('/api/auth/logout');
  } catch (error) {
    logger.warn('退出登录请求失败（忽略）', error);
  }
}

/** 启动时探测会话状态（cookie 自动携带） */
export async function getStatus(): Promise<AuthStatusResponse> {
  const response = await axiosForBackend.get('/api/auth/status');
  return response.data;
}

export async function me(): Promise<UserInfo> {
  const response = await axiosForBackend.get('/api/auth/me');
  return response.data;
}

export async function changePassword(
  oldPassword: string,
  newPassword: string,
): Promise<{ success: boolean }> {
  try {
    const response = await axiosForBackend.post('/api/auth/change-password', {
      oldPassword,
      newPassword,
    });
    return response.data;
  } catch (error) {
    logger.error('修改密码失败', error);
    throw error;
  }
}

/** 恢复码重置密码（免登录） */
export async function recoverPassword(
  username: string,
  code: string,
  newPassword: string,
): Promise<{ success: boolean }> {
  const response = await axiosForBackend.post('/api/auth/recover', {
    username,
    code,
    newPassword,
  });
  return response.data;
}

export async function getRecoveryStatus(): Promise<RecoveryCodesStatus> {
  const response = await axiosForBackend.get('/api/auth/recovery-codes');
  return response.data;
}

/** 重新生成恢复码（明文仅返回一次） */
export async function regenerateRecoveryCodes(): Promise<RecoveryCodesRegenerateResponse> {
  const response = await axiosForBackend.post('/api/auth/recovery-codes/regenerate');
  return response.data;
}
