import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Users, KeyRound, ArrowLeft } from 'lucide-react';
import { useAuth } from '@client/src/contexts/AuthContext';
import { recoverPassword } from '@client/src/api/auth';
import { logger } from '@lark-apaas/client-toolkit/logger';

type Mode = 'login' | 'recover';

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();

  const [mode, setMode] = useState<Mode>('login');

  // 登录表单
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 找回表单
  const [rUsername, setRUsername] = useState('');
  const [rCode, setRCode] = useState('');
  const [rNewPassword, setRNewPassword2] = useState('');
  const [rConfirm, setRConfirm] = useState('');
  const [rLoading, setRLoading] = useState(false);
  const [rError, setRError] = useState('');
  const [rSuccess, setRSuccess] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await login(username.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      logger.error('登录异常', err);
      const message =
        err && typeof err === 'object' && 'response' in err
          ? ((err as { response?: { data?: { message?: string } } }).response?.data?.message ?? '登录失败，请稍后重试')
          : '登录失败，请稍后重试';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rUsername.trim() || !rCode.trim() || !rNewPassword) {
      setRError('请填写完整信息');
      return;
    }
    if (rNewPassword.length < 8) {
      setRError('新密码至少需要 8 位字符');
      return;
    }
    if (rNewPassword !== rConfirm) {
      setRError('两次输入的新密码不一致');
      return;
    }
    setRLoading(true);
    setRError('');
    try {
      await recoverPassword(rUsername.trim(), rCode.trim(), rNewPassword);
      setRSuccess(true);
    } catch (err: unknown) {
      logger.error('恢复密码失败', err);
      const message =
        err && typeof err === 'object' && 'response' in err
          ? ((err as { response?: { data?: { message?: string } } }).response?.data?.message ?? '重置失败，请稍后重试')
          : '重置失败，请稍后重试';
      setRError(message);
    } finally {
      setRLoading(false);
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setRError('');
    setRSuccess(false);
  };

  const inputCls =
    'w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-colors';
  const labelCls = 'block text-sm font-medium text-slate-700 mb-1.5';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md px-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-xl bg-amber-600 flex items-center justify-center mb-4">
              <Users className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-semibold text-slate-900">知行朋友圈</h1>
            <p className="text-sm text-slate-500 mt-1">
              {mode === 'login' ? '让每一段人脉关系，都被认真对待' : '使用恢复码重置登录密码'}
            </p>
          </div>

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="username" className={labelCls}>
                  用户名
                </label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setUsername(e.target.value)
                  }
                  placeholder="请输入用户名"
                  className={inputCls}
                  disabled={loading}
                />
              </div>

              <div>
                <label htmlFor="password" className={labelCls}>
                  密码
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setPassword(e.target.value)
                  }
                  placeholder="请输入登录密码"
                  className={inputCls}
                  disabled={loading}
                />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 active:bg-amber-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? '登录中...' : '登录'}
              </button>

              <button
                type="button"
                onClick={() => switchMode('recover')}
                className="w-full text-center text-xs text-slate-500 hover:text-amber-700 transition-colors"
              >
                忘记密码？
              </button>
            </form>
          ) : (
            <form onSubmit={handleRecover} className="space-y-4">
              {rSuccess ? (
                <div className="text-center space-y-4">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                    <KeyRound className="w-6 h-6 text-emerald-600" />
                  </div>
                  <p className="text-sm text-slate-700">
                    密码已重置，该恢复码已失效。请使用新密码登录。
                  </p>
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="w-full py-2.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition-colors"
                  >
                    返回登录
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor="r-username" className={labelCls}>
                      用户名
                    </label>
                    <input
                      id="r-username"
                      type="text"
                      value={rUsername}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setRUsername(e.target.value)
                      }
                      placeholder="请输入用户名"
                      className={inputCls}
                      disabled={rLoading}
                    />
                  </div>

                  <div>
                    <label htmlFor="r-code" className={labelCls}>
                      恢复码
                    </label>
                    <input
                      id="r-code"
                      type="text"
                      value={rCode}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setRCode(e.target.value)
                      }
                      placeholder="rc_xxxxxxxx"
                      className={inputCls}
                      disabled={rLoading}
                    />
                  </div>

                  <div>
                    <label htmlFor="r-new" className={labelCls}>
                      新密码
                    </label>
                    <input
                      id="r-new"
                      type="password"
                      value={rNewPassword}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setRNewPassword2(e.target.value)
                      }
                      placeholder="至少 8 位字符"
                      className={inputCls}
                      disabled={rLoading}
                    />
                  </div>

                  <div>
                    <label htmlFor="r-confirm" className={labelCls}>
                      确认新密码
                    </label>
                    <input
                      id="r-confirm"
                      type="password"
                      value={rConfirm}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setRConfirm(e.target.value)
                      }
                      placeholder="再次输入新密码"
                      className={inputCls}
                      disabled={rLoading}
                    />
                  </div>

                  {rError && <p className="text-sm text-red-600">{rError}</p>}

                  <button
                    type="submit"
                    disabled={rLoading}
                    className="w-full py-2.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 active:bg-amber-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {rLoading ? '重置中...' : '重置密码'}
                  </button>

                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="w-full flex items-center justify-center gap-1 text-xs text-slate-500 hover:text-amber-700 transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    返回登录
                  </button>
                </>
              )}
            </form>
          )}
        </div>

        <p className="text-xs text-slate-400 text-center mt-6">
          © 2026 知行朋友圈
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
