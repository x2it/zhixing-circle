import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import * as authApi from '@client/src/api/auth';
import type { UserInfo } from '@shared/api.interface';

interface AuthContextValue {
  user: UserInfo | null;
  isAuthenticated: boolean;
  /** 启动时会话探测中（避免闪烁登录页） */
  initializing: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // 会话凭证为 HttpOnly cookie，前端不持有 token，只缓存用户信息
  const [user, setUser] = useState<UserInfo | null>(null);
  const [initializing, setInitializing] = useState(true);

  // 启动时探测一次会话
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await authApi.getStatus();
        if (!cancelled) {
          setUser(status.authenticated ? (status.user ?? null) : null);
        }
      } catch (error) {
        logger.warn('会话探测失败', error);
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    try {
      const result = await authApi.login(username, password);
      if (result.success && result.user) {
        setUser(result.user);
        return true;
      }
      return false;
    } catch (error) {
      logger.error('登录请求失败', error);
      throw error;
    }
  }, []);

  const logout = useCallback(() => {
    void authApi.logout();
    setUser(null);
  }, []);

  const value: AuthContextValue = {
    user,
    isAuthenticated: !!user,
    initializing,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
