import React, { useState, useEffect, useCallback } from 'react';
import {
  Copy,
  Check,
  KeyRound,
  Eye,
  EyeOff,
  RefreshCw,
  Trash2,
  Plus,
  Clock,
  AlertTriangle,
  BookOpen,
  MessageSquare,
  Phone,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@client/src/components/ui/card';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Switch } from '@client/src/components/ui/switch';
import { apiKeys } from '@client/src/api';
import { getSmsSyncSetting, setSmsSyncSetting, getCallSyncSetting, setCallSyncSetting } from '@client/src/api/settings';
import type { ApiKeyInfo, ApiKeyScope } from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';

/** 三档权限级别的展示文案 */
const SCOPE_OPTIONS: Array<{ value: ApiKeyScope; label: string; desc: string; detail: string }> = [
  {
    value: 'read',
    label: '只读',
    desc: '只能查询，任何写入都会被拒绝',
    detail: '允许：所有 GET 查询\n禁止：新增、修改、删除等一切写操作',
  },
  {
    value: 'write',
    label: '读写',
    desc: '能增删改数据、改模板、按 id 删除；不能清空和治理',
    detail:
      '允许：增删改联系人/跟进/短信/通话、修改模板、按 id 或按 ids 批量删除\n禁止：清空全部数据、数据治理、联系人合并、前缀清洗、密钥管理',
  },
  {
    value: 'admin',
    label: '全权',
    desc: '与登录账号同级，含清空与数据治理',
    detail:
      '允许：读写的全部能力，外加清空数据、数据治理（清理脏数据/去重/分层建议）、联系人合并、前缀清洗、批次合并、密钥管理',
  },
];

/** 权限级别选择器（三选一） */
const ScopePicker: React.FC<{
  value: ApiKeyScope;
  onChange: (v: ApiKeyScope) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => (
  <div className="flex flex-wrap gap-1.5">
    {SCOPE_OPTIONS.map((opt) => (
      <button
        key={opt.value}
        type="button"
        disabled={disabled}
        onClick={() => onChange(opt.value)}
        title={opt.desc}
        className={`px-2.5 py-1 text-xs rounded-md border transition-colors disabled:opacity-50 ${
          value === opt.value
            ? 'border-primary bg-primary/10 text-primary font-medium'
            : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

/** 权限徽章 */
const PermissionBadges: React.FC<{ scope: ApiKeyScope; rate: number }> = ({ scope, rate }) => {
  const opt = SCOPE_OPTIONS.find((o) => o.value === scope) ?? SCOPE_OPTIONS[2];
  return (
    <span className="flex items-center gap-1">
      <Badge
        variant="outline"
        className={`text-[9px] h-4 ${
          scope === 'admin'
            ? 'border-primary/40 text-primary bg-primary/10'
            : scope === 'write'
              ? 'border-blue-200 text-blue-700 bg-blue-50'
              : 'border-slate-200 text-slate-600 bg-slate-50'
        }`}
      >
        {opt.label}
      </Badge>
      <Badge variant="outline" className="text-[9px] h-4 border-border text-muted-foreground">
        {rate > 0 ? `${rate} 次/分` : '不限速'}
      </Badge>
    </span>
  );
};

const ApiKeySection: React.FC = () => {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // 创建表单：名称 / 权限级别 / 速率上限
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createScope, setCreateScope] = useState<ApiKeyScope>('admin');
  const [createRate, setCreateRate] = useState<number>(0);
  // 行内编辑权限
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editScope, setEditScope] = useState<ApiKeyScope>('admin');
  const [editRate, setEditRate] = useState<number>(0);

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiKeys.listKeys();
      setKeys(data);
    } catch (err) {
      logger.error('加载密钥失败', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async () => {
    try {
      setActionLoading('create');
      const result = await apiKeys.createKey({
        name: createName.trim() || undefined,
        scope: createScope,
        rateLimitPerMin: Number.isFinite(createRate) && createRate > 0 ? createRate : 0,
      });
      setNewKey(result.key);
      setVisible(true);
      setShowCreateForm(false);
      setCreateName('');
      setCreateScope('admin');
      setCreateRate(0);
      await fetchKeys();
      toast.success('密钥已生成，请立即保存，关闭后不再显示完整密钥');
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : '生成失败';
      toast.error(`生成失败：${msg}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReset = async (id: string) => {
    try {
      setActionLoading(`reset-${id}`);
      const result = await apiKeys.resetKey(id);
      setNewKey(result.key);
      setVisible(true);
      await fetchKeys();
      toast.success('已生成新密钥');
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : '重置失败';
      toast.error(`重置失败：${msg}`);
    } finally {
      setActionLoading(null);
    }
  };

  /** 打开行内权限编辑 */
  const startEdit = (key: ApiKeyInfo) => {
    setEditingId(key.id);
    setEditName(key.name ?? '');
    setEditScope(key.permissions?.scope ?? 'admin');
    setEditRate(key.permissions?.rateLimitPerMin ?? 0);
  };

  const handleUpdate = async (id: string) => {
    try {
      setActionLoading(`update-${id}`);
      await apiKeys.updateKey(id, {
        name: editName.trim() || undefined,
        scope: editScope,
        rateLimitPerMin: Number.isFinite(editRate) && editRate > 0 ? editRate : 0,
      });
      setEditingId(null);
      await fetchKeys();
      toast.success('权限已更新');
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : '更新失败';
      toast.error(`更新失败：${msg}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      setActionLoading(`revoke-${id}`);
      await apiKeys.revokeKey(id);
      const revokedKey = keys.find((k: ApiKeyInfo) => k.id === id);
      if (revokedKey && newKey && revokedKey.keyPrefix === newKey.slice(0, 10)) {
        setNewKey(null);
        setVisible(false);
      }
      setKeys((prev: ApiKeyInfo[]) => prev.filter((k: ApiKeyInfo) => k.id !== id));
      toast.success('已撤销');
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : '撤销失败';
      toast.error(`撤销失败：${msg}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCopyNewKey = () => {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey);
    toast.success('密钥已复制');
  };

  const displayKey = (key: ApiKeyInfo) => {
    if (!newKey || key.keyPrefix !== newKey.slice(0, 10)) {
      return `${key.keyPrefix}••••••••••`;
    }
    return visible ? newKey : `${key.keyPrefix}••••••••••`;
  };

  return (
    <Card className="border border-border shadow-none">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <KeyRound className="w-4.5 h-4.5" strokeWidth={1.5} />
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base font-medium">API 密钥管理</CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              密钥与账号权限同级（默认全权），且严格绑定你的账号，只能操作你自己的数据
            </CardDescription>
          </div>
          {keys.length > 0 && (
            <Button
              size="sm"
              onClick={() => setShowCreateForm((v) => !v)}
              className="h-8 text-xs"
            >
              <Plus className="w-3.5 h-3.5 mr-1" strokeWidth={1.5} />
              生成新密钥
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 创建表单：名称 / 权限级别 / 速率上限 */}
        {showCreateForm && (
          <div className="border border-border rounded-md p-3 space-y-3 bg-muted/30">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">备注名（可选）</label>
                <Input
                  value={createName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreateName(e.target.value)}
                  placeholder="如：主力手机同步"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  速率上限（次/分钟，0 = 不限）
                </label>
                <Input
                  type="number"
                  min={0}
                  value={createRate}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setCreateRate(Number(e.target.value) || 0)
                  }
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">权限级别</label>
              <ScopePicker value={createScope} onChange={setCreateScope} />
              <div className="rounded-md border border-border bg-background px-2.5 py-2 space-y-1">
                <p className="text-[11px] text-foreground/80">
                  {SCOPE_OPTIONS.find((o) => o.value === createScope)?.desc}
                </p>
                <p className="text-[11px] text-muted-foreground whitespace-pre-line leading-relaxed">
                  {SCOPE_OPTIONS.find((o) => o.value === createScope)?.detail}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setShowCreateForm(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={actionLoading === 'create'}
                onClick={handleCreate}
              >
                {actionLoading === 'create' ? '生成中...' : '生成密钥'}
              </Button>
            </div>
          </div>
        )}

        {loading && <div className="text-xs text-muted-foreground py-4 text-center">加载中...</div>}

        {!loading && keys.length === 0 && (
          <div className="flex flex-col items-center py-6 text-center border border-dashed border-border rounded-md">
            <KeyRound className="w-8 h-8 text-muted-foreground/50 mb-2" strokeWidth={1} />
            <p className="text-xs text-muted-foreground mb-3">尚未生成 API 密钥</p>
            <Button size="sm" onClick={handleCreate} className="h-7 text-xs">
              生成第一个密钥
            </Button>
          </div>
        )}

        {newKey && keys.length > 0 && (
          <div className="border border-amber-200 bg-amber-50/50 rounded-md p-3 space-y-3">
            <div className="flex items-center gap-1.5 mb-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" strokeWidth={1.5} />
              <span className="text-xs font-medium text-amber-800">
                请立即保存此密钥，关闭后不再显示完整内容
              </span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-slate-800 bg-white border border-amber-200 rounded px-2 py-1.5 break-all">
                {visible ? newKey : `${newKey.slice(0, 10)}••••••••••`}
              </code>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setVisible(!visible)}>
                {visible ? <EyeOff className="w-3.5 h-3.5" strokeWidth={1.5} /> : <Eye className="w-3.5 h-3.5" strokeWidth={1.5} />}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleCopyNewKey}>
                <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />
              </Button>
            </div>
            <div>
              <div className="text-xs text-amber-800 mb-1.5">Skill 文件地址</div>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                   value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/skill.md`}
                  className="h-8 text-xs font-mono bg-white border-amber-200"
                />
                 <CopyButton text={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/skill.md`} />
              </div>
            </div>
          </div>
        )}

        {keys.length > 0 && (
          <div className="space-y-2">
            {keys.map((key: ApiKeyInfo) => (
              <div key={key.id} className="border border-border rounded-md">
                <div className="flex items-center justify-between gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <code className="text-xs font-mono text-foreground/90 truncate">
                        {displayKey(key)}
                      </code>
                      {key.name && (
                        <span className="text-xs text-foreground/70">{key.name}</span>
                      )}
                      <Badge variant="outline" className="text-[9px] h-4 border-emerald-200 text-emerald-700 bg-emerald-50">
                        有效
                      </Badge>
                      <PermissionBadges
                        scope={key.permissions?.scope ?? 'admin'}
                        rate={key.permissions?.rateLimitPerMin ?? 0}
                      />
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" strokeWidth={1.5} />
                        创建于 {new Date(key.createdAt).toLocaleDateString('zh-CN')}
                      </span>
                      {key.lastUsedAt && (
                        <span>最近使用 {new Date(key.lastUsedAt).toLocaleDateString('zh-CN')}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => (editingId === key.id ? setEditingId(null) : startEdit(key))}
                      title="配置权限"
                    >
                      权限
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => handleReset(key.id)}
                      disabled={actionLoading === `reset-${key.id}`}
                      title="重置密钥"
                    >
                      <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.5} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                      onClick={() => handleRevoke(key.id)}
                      disabled={actionLoading === `revoke-${key.id}`}
                      title="撤销密钥"
                    >
                      <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                    </Button>
                  </div>
                </div>

                {/* 行内权限编辑 */}
                {editingId === key.id && (
                  <div className="border-t border-border p-3 space-y-3 bg-muted/30">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">备注名</label>
                        <Input
                          value={editName}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditName(e.target.value)}
                          placeholder="如：主力手机同步"
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">
                          速率上限（次/分钟，0 = 不限）
                        </label>
                        <Input
                          type="number"
                          min={0}
                          value={editRate}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setEditRate(Number(e.target.value) || 0)
                          }
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">权限级别</label>
                      <ScopePicker value={editScope} onChange={setEditScope} />
                      <div className="rounded-md border border-border bg-background px-2.5 py-2 space-y-1">
                        <p className="text-[11px] text-foreground/80">
                          {SCOPE_OPTIONS.find((o) => o.value === editScope)?.desc}
                        </p>
                        <p className="text-[11px] text-muted-foreground whitespace-pre-line leading-relaxed">
                          {SCOPE_OPTIONS.find((o) => o.value === editScope)?.detail}
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => setEditingId(null)}
                      >
                        取消
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={actionLoading === `update-${key.id}`}
                        onClick={() => handleUpdate(key.id)}
                      >
                        {actionLoading === `update-${key.id}` ? '保存中...' : '保存'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

interface CopyButtonProps {
  text: string;
}

const CopyButton: React.FC<CopyButtonProps> = ({ text }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success('已复制到剪贴板');
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleCopy}>
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 mr-1" strokeWidth={1.5} />
          已复制
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5 mr-1" strokeWidth={1.5} />
          复制链接
        </>
      )}
    </Button>
  );
};

/** 通用同步开关卡片（短信 / 通话共用） */
const SyncToggleCard: React.FC<{
  title: string;
  description: string;
  icon: React.FC<{ className?: string; strokeWidth?: number }>;
  enabled: boolean;
  loading: boolean;
  switching: boolean;
  onToggle: (next: boolean) => void;
}> = ({ title, description, icon: Icon, enabled, loading, switching, onToggle }) => (
  <Card className="border border-border shadow-none">
    <CardHeader className="pb-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
          <Icon className="w-4.5 h-4.5" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <CardTitle className="text-base font-medium">{title}</CardTitle>
          <CardDescription className="text-xs text-muted-foreground mt-0.5">
            {description}
          </CardDescription>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(next: boolean) => onToggle(next)}
          disabled={loading || switching}
        />
      </div>
    </CardHeader>
  </Card>
);

/** 短信同步开关（App 上报短信前检查此开关） */
const SmsSyncSection: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    getSmsSyncSetting()
      .then((s) => setEnabled(s.smsSyncEnabled))
      .catch(() => toast.error('获取短信同步开关失败'))
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = async (next: boolean) => {
    try {
      setSwitching(true);
      const result = await setSmsSyncSetting(next);
      setEnabled(result.smsSyncEnabled);
      toast.success(result.smsSyncEnabled ? '已开启短信同步' : '已关闭短信同步');
    } catch {
      toast.error('设置失败，请重试');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <SyncToggleCard
      title="短信同步"
      description="允许 App 与 API 读写短信记录，敏感数据请谨慎开启"
      icon={MessageSquare}
      enabled={enabled}
      loading={loading}
      switching={switching}
      onToggle={handleToggle}
    />
  );
};

/** 通话同步开关（App 上报通话前检查此开关） */
const CallSyncSection: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    getCallSyncSetting()
      .then((s) => setEnabled(s.callSyncEnabled))
      .catch(() => toast.error('获取通话同步开关失败'))
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = async (next: boolean) => {
    try {
      setSwitching(true);
      const result = await setCallSyncSetting(next);
      setEnabled(result.callSyncEnabled);
      toast.success(result.callSyncEnabled ? '已开启通话同步' : '已关闭通话同步');
    } catch {
      toast.error('设置失败，请重试');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <SyncToggleCard
      title="通话同步"
      description="允许 App 与 API 读写通话记录，敏感数据请谨慎开启"
      icon={Phone}
      enabled={enabled}
      loading={loading}
      switching={switching}
      onToggle={handleToggle}
    />
  );
};

const ApiDocsPage: React.FC = () => {
  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="space-y-1">
        <h2 className="text-xl font-medium text-foreground">API 接入</h2>
        <p className="text-xs text-muted-foreground">
          通过 API Key 或 Skill 文件对接智能体，自动化管理人脉数据
        </p>
      </div>

      <ApiKeySection />
      <SmsSyncSection />
      <CallSyncSection />
    </div>
  );
};

export default ApiDocsPage;
