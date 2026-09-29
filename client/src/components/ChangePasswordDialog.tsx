import React, { useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, ShieldAlert } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import { changePassword } from '@client/src/api/auth';

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ChangePasswordDialog: React.FC<ChangePasswordDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setOldPassword('');
    setNewPassword('');
    setConfirm('');
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPassword || !newPassword) {
      setError('请填写完整');
      return;
    }
    if (newPassword.length < 8) {
      setError('新密码至少需要 8 位字符');
      return;
    }
    if (newPassword !== confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await changePassword(oldPassword, newPassword);
      toast.success('密码已修改');
      reset();
      onOpenChange(false);
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? ((err as { response?: { data?: { message?: string } } }).response?.data?.message ?? '修改失败，请稍后重试')
          : '修改失败，请稍后重试';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    'w-full px-3.5 py-2.5 rounded-lg border border-input bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-colors';
  const labelCls = 'block text-sm font-medium text-foreground mb-1.5';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4.5 h-4.5 text-primary" strokeWidth={1.5} />
            修改密码
          </DialogTitle>
          <DialogDescription>
            修改成功后当前登录保持有效，其它设备将需要重新登录。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="cp-old" className={labelCls}>
              原密码
            </label>
            <input
              id="cp-old"
              type="password"
              autoComplete="current-password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder="请输入当前密码"
              className={inputCls}
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="cp-new" className={labelCls}>
              新密码
            </label>
            <input
              id="cp-new"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="至少 8 位字符"
              className={inputCls}
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="cp-confirm" className={labelCls}>
              确认新密码
            </label>
            <input
              id="cp-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="再次输入新密码"
              className={inputCls}
              disabled={loading}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4" strokeWidth={1.5} />
              {error}
            </p>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
              className="px-4 py-2 rounded-lg border border-input text-sm text-foreground hover:bg-muted transition-colors"
              disabled={loading}
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? '提交中...' : '确认修改'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ChangePasswordDialog;
