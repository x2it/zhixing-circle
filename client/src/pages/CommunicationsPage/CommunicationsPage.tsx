import React, { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  ArrowDownLeft,
  ArrowUpRight,
  Trash2,
  Search,
  ShieldOff,
  ChevronLeft,
  CheckSquare,
  Square,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@client/src/components/ui/tabs';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import PaginationSimple from '@client/src/pages/ContactsPage/PaginationSimple';
import {
  getMessages,
  getConversations,
  deleteMessage,
  deleteMessages,
  getCalls,
  deleteCall,
  deleteCalls,
  getSyncStatus,
} from '@client/src/api/communications';
import type { Message, Call, Conversation, SyncStatus } from '@shared/api.interface';

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

/** 每页条数选择器：沟通记录量大，让用户自己决定一屏看多少 */
const PageSizeSelector: React.FC<{
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => (
  <label className="flex items-center gap-1.5 text-xs text-slate-500 select-none">
    每页
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-8 rounded-md border border-input bg-background px-1.5 text-xs text-foreground disabled:opacity-50"
    >
      {PAGE_SIZE_OPTIONS.map((n) => (
        <option key={n} value={n}>{n} 条</option>
      ))}
    </select>
  </label>
);

/** 通话时长档位 → 秒区间；null 表示不限 */
const DURATION_PRESETS: Array<{ value: string; label: string; min?: number; max?: number }> = [
  { value: '', label: '全部时长' },
  { value: 'missed', label: '未接通（0 秒）', min: 0, max: 0 },
  { value: 'short', label: '30 秒内', min: 1, max: 30 },
  { value: 'medium', label: '30 秒 ~ 5 分钟', min: 30, max: 300 },
  { value: 'long', label: '5 分钟以上', min: 300 },
];

const SORT_OPTIONS_CALL = [
  { value: 'date-desc', label: '时间：最新优先' },
  { value: 'date-asc', label: '时间：最早优先' },
  { value: 'duration-desc', label: '时长：最长优先' },
  { value: 'duration-asc', label: '时长：最短优先' },
];

const SORT_OPTIONS_SMS = [
  { value: 'date-desc', label: '时间：最新优先' },
  { value: 'date-asc', label: '时间：最早优先' },
];

const formatTime = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const formatDuration = (seconds: number): string => {
  if (!seconds) return '未接通';
  if (seconds < 60) return `${seconds} 秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} 分 ${s} 秒` : `${m} 分钟`;
};

/** 备份状态卡：只读展示云端条数与最近同步时间（开关统一在「API 接入」页管理） */
const SyncCard: React.FC<{
  title: string;
  icon: React.FC<{ className?: string; strokeWidth?: number }>;
  enabled: boolean;
  total: number;
  lastSyncAt: string | null;
}> = ({ title, icon: Icon, enabled, total, lastSyncAt }) => {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-4.5 h-4.5 text-slate-400 shrink-0" strokeWidth={1.5} />
          <span className="text-sm font-medium text-slate-800">{title}</span>
        </div>
        {enabled ? (
          <span className="text-xs text-emerald-600">已开启</span>
        ) : (
          <span className="text-xs text-slate-400">未开启</span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-lg font-semibold text-slate-900">{total}</span>
        <span className="text-xs text-slate-500">条已备份</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">最近同步 {formatTime(lastSyncAt)}</p>
    </div>
  );
};

const CommunicationsPage: React.FC = () => {
  const [tab, setTab] = useState<'sms' | 'call'>('sms');

  // 备份状态
  const [status, setStatus] = useState<SyncStatus | null>(null);

  // 短信：会话 / 会话内
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convTotal, setConvTotal] = useState(0);
  const [convPage, setConvPage] = useState(1);
  const [convPageSize, setConvPageSize] = useState(50);
  const [convLoading, setConvLoading] = useState(false);
  const [convForbidden, setConvForbidden] = useState(false);
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [thread, setThread] = useState<Message[]>([]);
  const [threadTotal, setThreadTotal] = useState(0);
  const [threadPage, setThreadPage] = useState(1);
  const [threadPageSize, setThreadPageSize] = useState(50);
  const [threadLoading, setThreadLoading] = useState(false);

  // 短信内容搜索命中（关键词非空时的直接结果列表）
  const [smsHits, setSmsHits] = useState<Message[]>([]);
  const [smsHitsTotal, setSmsHitsTotal] = useState(0);
  const [smsHitsLoading, setSmsHitsLoading] = useState(false);
  const [smsHitsPage, setSmsHitsPage] = useState(1);

  // 通话
  const [calls, setCalls] = useState<Call[]>([]);
  const [callTotal, setCallTotal] = useState(0);
  const [callPage, setCallPage] = useState(1);
  const [callPageSize, setCallPageSize] = useState(50);
  const [callLoading, setCallLoading] = useState(false);
  const [callForbidden, setCallForbidden] = useState(false);

  // 搜索与筛选（方向 / 日期范围作用于短信与通话）
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [direction, setDirection] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  /** 通话时长档位（见 DURATION_PRESETS），空串=不限 */
  const [durationRange, setDurationRange] = useState('');
  /** 排序键：`<sortBy>-<sortOrder>`，默认 date-desc */
  const [sortKey, setSortKey] = useState('date-desc');

  // 多选删除
  const [smsSel, setSmsSel] = useState<Set<string>>(new Set());
  const [callSel, setCallSel] = useState<Set<string>>(new Set());

  const hasFilter = !!(keyword || direction || dateFrom || dateTo || durationRange || sortKey !== 'date-desc');

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await getSyncStatus());
    } catch {
      /* 状态读取失败不阻塞页面 */
    }
  }, []);

  const loadConversations = useCallback(async () => {
    setConvLoading(true);
    try {
      const res = await getConversations({ page: convPage, pageSize: convPageSize, keyword: keyword || undefined });
      setConversations(res.items);
      setConvTotal(res.total);
      setConvForbidden(false);
    } catch (error: unknown) {
      const s = (error as { response?: { status?: number } })?.response?.status;
      if (s === 403) {
        setConvForbidden(true);
        setConversations([]);
        setConvTotal(0);
      } else {
        toast.error('短信会话加载失败');
      }
    } finally {
      setConvLoading(false);
    }
  }, [convPage, convPageSize, keyword]);

  const loadThread = useCallback(async () => {
    if (!activePhone) return;
    setThreadLoading(true);
    try {
      const res = await getMessages({
        page: threadPage,
        pageSize: threadPageSize,
        phone: activePhone,
        keyword: keyword || undefined,
        direction: direction || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        sortOrder: sortKey === 'date-asc' ? 'asc' : undefined,
      });
      setThread(res.items);
      setThreadTotal(res.total);
    } catch {
      toast.error('短信详情加载失败');
    } finally {
      setThreadLoading(false);
    }
  }, [activePhone, threadPage, threadPageSize, keyword, direction, dateFrom, dateTo, sortKey]);

  /** 全局内容搜索：按关键词直接命中短信原文（跨会话） */
  const loadSmsHits = useCallback(async () => {
    if (!keyword && !direction && !dateFrom && !dateTo) {
      setSmsHits([]);
      setSmsHitsTotal(0);
      return;
    }
    setSmsHitsLoading(true);
    try {
      const res = await getMessages({
        page: smsHitsPage,
        pageSize: 50,
        keyword: keyword || undefined,
        direction: direction || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        sortOrder: sortKey === 'date-asc' ? 'asc' : undefined,
      });
      setSmsHits(res.items);
      setSmsHitsTotal(res.total);
    } catch (error: unknown) {
      const s = (error as { response?: { status?: number } })?.response?.status;
      if (s === 403) {
        setSmsHits([]);
        setSmsHitsTotal(0);
      } else {
        toast.error('短信搜索失败');
      }
    } finally {
      setSmsHitsLoading(false);
    }
  }, [keyword, direction, dateFrom, dateTo, smsHitsPage, sortKey]);

  const loadCalls = useCallback(async () => {
    setCallLoading(true);
    try {
      const preset = DURATION_PRESETS.find((p) => p.value === durationRange);
      const [sortBy, sortOrder] = sortKey.split('-');
      const res = await getCalls({
        page: callPage,
        pageSize: callPageSize,
        keyword: keyword || undefined,
        direction: direction || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        minDuration: preset?.min,
        maxDuration: preset?.max,
        sortBy: sortBy || undefined,
        sortOrder: sortOrder || undefined,
      });
      setCalls(res.items);
      setCallTotal(res.total);
      setCallForbidden(false);
    } catch (error: unknown) {
      const s = (error as { response?: { status?: number } })?.response?.status;
      if (s === 403) {
        setCallForbidden(true);
        setCalls([]);
        setCallTotal(0);
      } else {
        toast.error('通话记录加载失败');
      }
    } finally {
      setCallLoading(false);
    }
  }, [callPage, callPageSize, keyword, direction, dateFrom, dateTo, durationRange, sortKey]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (tab !== 'sms' || activePhone) return;
    // 关键词/筛选非空 → 直接列出命中的短信原文；为空 → 会话列表
    void loadSmsHits();
    if (!hasFilter) void loadConversations();
  }, [tab, activePhone, loadSmsHits, loadConversations, hasFilter]);

  useEffect(() => {
    if (tab === 'sms' && activePhone) void loadThread();
  }, [tab, activePhone, loadThread]);

  useEffect(() => {
    if (tab === 'call') void loadCalls();
  }, [tab, loadCalls]);

  // 输入即搜：防抖 350ms 自动应用关键词，清空输入框也会自动恢复完整列表。
  // 之前只有按回车才搜，加上旁边图标是"刷新"，看起来就像搜索完全没生效。
  useEffect(() => {
    const timer = setTimeout(() => {
      setKeyword(searchInput.trim());
      setConvPage(1);
      setThreadPage(1);
      setCallPage(1);
      setSmsHitsPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const applySearch = () => {
    setKeyword(searchInput.trim());
    setConvPage(1);
    setThreadPage(1);
    setCallPage(1);
    setSmsHitsPage(1);
  };

  const clearFilters = () => {
    setSearchInput('');
    setKeyword('');
    setDirection('');
    setDateFrom('');
    setDateTo('');
    setDurationRange('');
    setSortKey('date-desc');
    setConvPage(1);
    setThreadPage(1);
    setCallPage(1);
    setSmsHitsPage(1);
  };

  const handleDeleteConversation = async (phone: string) => {
    try {
      const res = await deleteMessages({ phone });
      toast.success(`已删除该会话 ${res.deleted} 条`);
      void loadConversations();
      void loadStatus();
    } catch {
      toast.error('删除失败');
    }
  };

  const handleDeleteSelectedSms = async () => {
    if (smsSel.size === 0) return;
    try {
      const res = await deleteMessages({ ids: [...smsSel] });
      toast.success(`已删除 ${res.deleted} 条`);
      setSmsSel(new Set());
      void (activePhone ? loadThread() : loadConversations());
      void loadStatus();
    } catch {
      toast.error('删除失败');
    }
  };

  const handleClearAllSms = async () => {
    try {
      const res = await deleteMessages({ all: true });
      toast.success(`已清空 ${res.deleted} 条短信`);
      setActivePhone(null);
      setConvPage(1);
      void loadConversations();
      void loadStatus();
    } catch {
      toast.error('清空失败');
    }
  };

  const handleDeleteSelectedCalls = async () => {
    if (callSel.size === 0) return;
    try {
      const res = await deleteCalls({ ids: [...callSel] });
      toast.success(`已删除 ${res.deleted} 条`);
      setCallSel(new Set());
      void loadCalls();
      void loadStatus();
    } catch {
      toast.error('删除失败');
    }
  };

  const handleClearAllCalls = async () => {
    try {
      const res = await deleteCalls({ all: true });
      toast.success(`已清空 ${res.deleted} 条通话记录`);
      setCallPage(1);
      void loadCalls();
      void loadStatus();
    } catch {
      toast.error('清空失败');
    }
  };

  const toggleSel = (set: Set<string>, setFn: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFn(next);
  };

  const EmptyHint: React.FC<{ kind: 'sms' | 'call'; forbidden: boolean }> = ({ kind, forbidden }) => (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <ShieldOff className="w-6 h-6 text-slate-300" strokeWidth={1.5} />
      <p className="text-sm text-slate-500">
        {forbidden
          ? `${kind === 'sms' ? '短信' : '通话'}备份未开启`
          : `云端还没有${kind === 'sms' ? '短信' : '通话'}记录`}
      </p>
      <p className="text-xs text-slate-400 px-6">
        {forbidden
          ? '打开上方开关后，App 才能把数据上报到云端'
          : '在 App「数据」页点「同步到云端」，成功后这里会显示'}
      </p>
    </div>
  );

  return (
    <div className="space-y-4 md:space-y-5">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">沟通记录</h2>
        <p className="text-sm text-slate-600 mt-1">短信与通话的云端备份</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SyncCard
          title="短信备份"
          icon={MessageSquare}
          enabled={status?.smsSyncEnabled ?? false}
          total={status?.smsTotal ?? 0}
          lastSyncAt={status?.lastSmsSyncAt ?? null}
        />
        <SyncCard
          title="通话备份"
          icon={Phone}
          enabled={status?.callSyncEnabled ?? false}
          total={status?.callTotal ?? 0}
          lastSyncAt={status?.lastCallSyncAt ?? null}
        />
      </div>

      <Tabs
        value={tab}
        onValueChange={(v: string) => {
          setTab(v as 'sms' | 'call');
          setActivePhone(null);
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="sms" className="gap-1.5">
              <MessageSquare className="w-4 h-4" strokeWidth={1.5} />
              短信
            </TabsTrigger>
            <TabsTrigger value="call" className="gap-1.5">
              <Phone className="w-4 h-4" strokeWidth={1.5} />
              通话
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:flex-none">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                value={searchInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchInput(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter') applySearch();
                }}
                placeholder="搜短信内容、号码、联系人"
                className="pl-9 w-full sm:w-56"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={applySearch}
              title="搜索"
            >
              <Search className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* 筛选行：方向 + 日期范围（对短信与通话同时生效） */}
        <div className="flex flex-wrap items-center gap-2 -mt-1">
          <select
            value={direction}
            onChange={(e) => {
              setDirection(e.target.value);
              setConvPage(1); setThreadPage(1); setCallPage(1); setSmsHitsPage(1);
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            aria-label="方向筛选"
          >
            <option value="">全部方向</option>
            {tab === 'sms' ? (
              <>
                <option value="in">只看收到</option>
                <option value="out">只看发出</option>
              </>
            ) : (
              <>
                <option value="in">只看呼入</option>
                <option value="out">只看呼出</option>
                <option value="missed">只看未接</option>
              </>
            )}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            从
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setConvPage(1); setThreadPage(1); setCallPage(1); setSmsHitsPage(1);
              }}
              className="h-8 rounded-md border border-input bg-background px-1.5 text-xs text-foreground"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            至
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setConvPage(1); setThreadPage(1); setCallPage(1); setSmsHitsPage(1);
              }}
              className="h-8 rounded-md border border-input bg-background px-1.5 text-xs text-foreground"
            />
          </label>
          {/* 通话专属：时长档位 */}
          {tab === 'call' && (
            <select
              value={durationRange}
              onChange={(e) => {
                setDurationRange(e.target.value);
                setCallPage(1);
              }}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
              aria-label="通话时长筛选"
            >
              {DURATION_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          )}
          {/* 排序：通话支持按时长，短信只按时间 */}
          <select
            value={sortKey}
            onChange={(e) => {
              setSortKey(e.target.value);
              setConvPage(1); setThreadPage(1); setCallPage(1); setSmsHitsPage(1);
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            aria-label="排序方式"
          >
            {(tab === 'call' ? SORT_OPTIONS_CALL : SORT_OPTIONS_SMS).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {hasFilter && (
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={clearFilters}>
              <X className="w-3.5 h-3.5" />
              清除筛选
            </Button>
          )}
        </div>

        {/* ===== 短信 ===== */}
        <TabsContent value="sms" className="mt-3">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            {activePhone ? (
              <>
                <div className="flex items-center gap-2 p-3 border-b border-slate-100">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1"
                    onClick={() => {
                      setActivePhone(null);
                      setThreadPage(1);
                      setSmsSel(new Set());
                    }}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    返回
                  </Button>
                  <span className="text-sm font-medium text-slate-900 truncate flex-1">{activePhone}</span>
                  <span className="text-xs text-slate-400 shrink-0">共 {threadTotal} 条</span>
                  {smsSel.size > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600"
                      onClick={() => void handleDeleteSelectedSms()}
                    >
                      删除 {smsSel.size} 条
                    </Button>
                  )}
                </div>
                {threadLoading ? (
                  <div className="py-10 text-center text-sm text-slate-400">加载中...</div>
                ) : thread.length === 0 ? (
                  <div className="py-10 text-center text-sm text-slate-400">暂无短信</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {thread.map((m: Message) => (
                      <div key={m.id} className="flex items-start gap-3 p-3 md:p-4">
                        <button
                          onClick={() => toggleSel(smsSel, setSmsSel, m.id)}
                          className="mt-0.5 text-slate-300 hover:text-slate-500 shrink-0"
                          aria-label="选择"
                        >
                          {smsSel.has(m.id) ? (
                            <CheckSquare className="w-4 h-4" strokeWidth={1.5} />
                          ) : (
                            <Square className="w-4 h-4" strokeWidth={1.5} />
                          )}
                        </button>
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                            m.direction === 'in' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'
                          }`}
                        >
                          {m.direction === 'in' ? (
                            <ArrowDownLeft className="w-4 h-4" strokeWidth={1.5} />
                          ) : (
                            <ArrowUpRight className="w-4 h-4" strokeWidth={1.5} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-700 break-all">{m.body}</p>
                          <p className="text-xs text-slate-400 mt-1">
                            {m.messageDate}
                            {m.direction === 'in' ? ' · 收到' : ' · 发出'}
                          </p>
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              await deleteMessage(m.id);
                              toast.success('已删除');
                              void loadThread();
                              void loadStatus();
                            } catch {
                              toast.error('删除失败');
                            }
                          }}
                          className="p-1.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 shrink-0"
                          aria-label="删除"
                        >
                          <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {thread.length > 0 && (
                  <div className="border-t border-slate-100">
                    <PaginationSimple
                      page={threadPage}
                      pageSize={threadPageSize}
                      total={threadTotal}
                      onPageChange={setThreadPage}
                    />
                    <div className="flex justify-center pb-2 -mt-1">
                      <PageSizeSelector
                        value={threadPageSize}
                        onChange={(n) => { setThreadPageSize(n); setThreadPage(1); }}
                      />
                    </div>
                  </div>
                )}
              </>
            ) : hasFilter ? (
              <>
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100">
                  <span className="text-xs text-slate-500">
                    {keyword ? <>包含「{keyword}」的短信</> : '筛选结果'} · 共 {smsHitsTotal} 条
                  </span>
                </div>
                {smsHitsLoading ? (
                  <div className="py-10 text-center text-sm text-slate-400">搜索中...</div>
                ) : smsHits.length === 0 ? (
                  <EmptyHint kind="sms" forbidden={convForbidden} />
                ) : (
                  <div className="divide-y divide-slate-100">
                    {smsHits.map((m: Message) => (
                      <button
                        key={m.id}
                        onClick={() => { setActivePhone(m.phone); setThreadPage(1); setSmsSel(new Set()); }}
                        className="w-full flex items-start gap-3 p-3 md:p-4 text-left hover:bg-slate-50 transition-colors"
                      >
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                            m.direction === 'in' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'
                          }`}
                        >
                          {m.direction === 'in' ? (
                            <ArrowDownLeft className="w-4 h-4" strokeWidth={1.5} />
                          ) : (
                            <ArrowUpRight className="w-4 h-4" strokeWidth={1.5} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-medium text-slate-900 truncate">
                              {m.contactName || m.phone}
                            </span>
                            <span className="text-xs text-slate-400 shrink-0">{m.messageDate}</span>
                          </div>
                          <p className="text-sm text-slate-600 break-all line-clamp-2 mt-0.5">{m.body}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {smsHits.length > 0 && (
                  <div className="border-t border-slate-100">
                    <PaginationSimple
                      page={smsHitsPage}
                      pageSize={50}
                      total={smsHitsTotal}
                      onPageChange={setSmsHitsPage}
                    />
                  </div>
                )}
              </>
            ) : convLoading ? (
              <div className="py-10 text-center text-sm text-slate-400">加载中...</div>
            ) : conversations.length === 0 ? (
              <EmptyHint kind="sms" forbidden={convForbidden} />
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100">
                  <span className="text-xs text-slate-500">共 {convTotal} 个会话</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600"
                    onClick={() => void handleClearAllSms()}
                  >
                    清空全部
                  </Button>
                </div>
                <div className="divide-y divide-slate-100">
                  {conversations.map((c: Conversation) => (
                    <div key={c.phone} className="flex items-center gap-3 p-3 md:p-4">
                      <button
                        onClick={() => setActivePhone(c.phone)}
                        className="flex items-center gap-3 flex-1 min-w-0 text-left"
                      >
                        <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                          <MessageSquare className="w-4 h-4" strokeWidth={1.5} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-medium text-slate-900 truncate">
                              {c.contactName || c.phone}
                            </span>
                            <span className="text-xs text-slate-400 shrink-0">{c.messageCount} 条</span>
                          </div>
                          <p className="text-xs text-slate-500 truncate mt-0.5">
                            {c.lastDirection === 'out' ? '我：' : ''}
                            {c.lastBody}
                          </p>
                        </div>
                        <span className="text-xs text-slate-400 shrink-0">{c.lastMessageDate}</span>
                      </button>
                      <button
                        onClick={() => void handleDeleteConversation(c.phone)}
                        className="p-1.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 shrink-0"
                        aria-label="删除整个会话"
                        title="删除整个会话"
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="border-t border-slate-100">
                  <PaginationSimple
                    page={convPage}
                    pageSize={convPageSize}
                    total={convTotal}
                    onPageChange={setConvPage}
                  />
                  <div className="flex justify-center pb-2 -mt-1">
                    <PageSizeSelector
                      value={convPageSize}
                      onChange={(n) => { setConvPageSize(n); setConvPage(1); }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </TabsContent>

        {/* ===== 通话 ===== */}
        <TabsContent value="call" className="mt-3">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            {callLoading ? (
              <div className="py-10 text-center text-sm text-slate-400">加载中...</div>
            ) : calls.length === 0 ? (
              <EmptyHint kind="call" forbidden={callForbidden} />
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100">
                  <span className="text-xs text-slate-500">
                    共 {callTotal} 条{callSel.size > 0 ? ` · 已选 ${callSel.size}` : ''}
                  </span>
                  <div className="flex items-center gap-2">
                    {callSel.size > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600"
                        onClick={() => void handleDeleteSelectedCalls()}
                      >
                        删除 {callSel.size} 条
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600"
                      onClick={() => void handleClearAllCalls()}
                    >
                      清空全部
                    </Button>
                  </div>
                </div>
                <div className="divide-y divide-slate-100">
                  {calls.map((c: Call) => {
                    const Icon =
                      c.direction === 'in' ? PhoneIncoming : c.direction === 'out' ? PhoneOutgoing : PhoneMissed;
                    const tone =
                      c.direction === 'in'
                        ? 'bg-blue-50 text-blue-600'
                        : c.direction === 'out'
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-red-50 text-red-500';
                    const label = c.direction === 'in' ? '呼入' : c.direction === 'out' ? '呼出' : '未接';
                    return (
                      <div key={c.id} className="flex items-center gap-3 p-3 md:p-4">
                        <button
                          onClick={() => toggleSel(callSel, setCallSel, c.id)}
                          className="text-slate-300 hover:text-slate-500 shrink-0"
                          aria-label="选择"
                        >
                          {callSel.has(c.id) ? (
                            <CheckSquare className="w-4 h-4" strokeWidth={1.5} />
                          ) : (
                            <Square className="w-4 h-4" strokeWidth={1.5} />
                          )}
                        </button>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${tone}`}>
                          <Icon className="w-4 h-4" strokeWidth={1.5} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-medium text-slate-900 truncate">
                              {c.contactName || c.phone}
                            </span>
                            <span className="text-xs text-slate-400 shrink-0">{label}</span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {c.callDate} · {formatDuration(c.duration)}
                          </p>
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              await deleteCall(c.id);
                              toast.success('已删除');
                              void loadCalls();
                              void loadStatus();
                            } catch {
                              toast.error('删除失败');
                            }
                          }}
                          className="p-1.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 shrink-0"
                          aria-label="删除"
                        >
                          <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-slate-100">
                  <PaginationSimple
                    page={callPage}
                    pageSize={callPageSize}
                    total={callTotal}
                    onPageChange={setCallPage}
                  />
                  <div className="flex justify-center pb-2 -mt-1">
                    <PageSizeSelector
                      value={callPageSize}
                      onChange={(n) => { setCallPageSize(n); setCallPage(1); }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default CommunicationsPage;
