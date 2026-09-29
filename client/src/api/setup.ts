import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

/**
 * 全局 401 处理：
 * 会话过期/未登录时，除登录/状态探测接口外，统一跳转登录页。
 */
let redirecting = false;

export function setupAuthInterceptor() {
  axiosForBackend.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
      const status =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { status?: number } }).response?.status
          : undefined;
      const url =
        error && typeof error === 'object' && 'config' in error
          ? String((error as { config?: { url?: string } }).config?.url ?? '')
          : '';

      if (status === 401 && !redirecting) {
        // 登录动作本身失败（密码错误）与会话探测不触发跳转
        const isAuthPath =
          url.includes('/api/auth/login') ||
          url.includes('/api/auth/status') ||
          url.includes('/api/auth/recover');
        if (!isAuthPath && !window.location.pathname.startsWith('/login')) {
          redirecting = true;
          window.location.href = '/login';
        }
      }
      return Promise.reject(error);
    },
  );
}
