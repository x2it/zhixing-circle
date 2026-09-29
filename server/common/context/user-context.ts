import { AsyncLocalStorage } from 'async_hooks';

/**
 * 请求级用户上下文（AsyncLocalStorage）
 * 由 AuthMiddleware 在鉴权成功后写入，service 层统一读取，实现多用户数据隔离。
 */
export interface UserContextPayload {
  userId: string;
  username: string;
  role: string;
  /** session = 网页会话; apiKey = Bearer zx_ 密钥 */
  authType: 'session' | 'apiKey';
}

export class UserContext {
  private static storage = new AsyncLocalStorage<UserContextPayload>();

  static run<T>(payload: UserContextPayload, fn: () => T): T {
    return this.storage.run(payload, fn);
  }

  static get(): UserContextPayload | undefined {
    return this.storage.getStore();
  }

  static getUserId(): string {
    const ctx = this.storage.getStore();
    if (!ctx?.userId) {
      // 理论上 AuthMiddleware 已拦截未登录请求；此处兜底防止数据越权
      throw new Error('UserContext 未初始化（缺少鉴权中间件）');
    }
    return ctx.userId;
  }

  static tryGetUserId(): string | undefined {
    return this.storage.getStore()?.userId;
  }
}
