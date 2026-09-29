/**
 * 数据治理面板
 * 1) 批次合并：把 App 碎片化的 N 个批次合成一个，批次列表不再刷屏
 * 2) 智能清洗：识别姓名前缀（yj/b/w 等），可批量去前缀或转为标签，先预览再执行
 * 3) 重复检测 + 确认式合并：按归一化手机号判重；同名仅提示（同名未必同一人），
 *    必须人工勾选确认后才合并，服务端写合并日志可追溯
 * 4) 短信/通话去重：App 重复备份产生的完全相同记录，先预览样本再一键清理（每组保留最早一条）
 */
import React, { useState } from 'react';
import { toast } from 'sonner';
import { Wand2, Copy, Merge, Loader2, CheckSquare, Square, AlertTriangle, MessageSquareText, PhoneCall } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { mergeBatches } from '@client/src/api/batches';
import {
  analyzePrefixes,
  cleanPrefix,
  findDuplicates,
  mergeContacts,
} from '@client/src/api/contacts';
import { getCommDedupPreview, executeCommDedup } from '@client/src/api/data';
import type {
  ImportBatch,
  PrefixStat,
  PrefixCleanResponse,
  DuplicateGroup,
  DuplicateContact,
  CommDedupPreviewResponse,
  CommDedupStat,
} from '@shared/api.interface';

const GovernancePanel: React.FC<{
  batches: ImportBatch[];
  onBatchesChanged: () => void;
}> = ({ batches, onBatchesChanged }) => {
  // ---- 批次合并 ----
  const [mergeMode, setMergeMode] = useState(false);
  const [pickedBatches, setPickedBatches] = useState<string[]>([]);
  const [mergeName, setMergeName] = useState('');
  const [mergingBatches, setMergingBatches] = useState(false);

  // ---- 智能清洗 ----
  const [prefixStats, setPrefixStats] = useState<PrefixStat[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [cleanPreview, setCleanPreview] = useState<PrefixCleanResponse | null>(null);
  const [pendingClean, setPendingClean] = useState<{
    prefix: string;
    mode: 'strip' | 'tag';
    tagName?: string;
  } | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [tagInput, setTagInput] = useState('');

  // ---- 重复检测 ----
  const [dupGroups, setDupGroups] = useState<DuplicateGroup[] | null>(null);
  const [dupLoading, setDupLoading] = useState(false);
  const [pickedGroups, setPickedGroups] = useState<Record<string, boolean>>({});
  const [keepChoice, setKeepChoice] = useState<Record<string, string>>({});
  const [mergingContacts, setMergingContacts] = useState(false);

  // ---- 短信/通话去重 ----
  const [commPreview, setCommPreview] = useState<CommDedupPreviewResponse | null>(null);
  const [commLoading, setCommLoading] = useState(false);
  const [cleaningKind, setCleaningKind] = useState<'sms' | 'calls' | null>(null);

  // ===== 批次合并 =====
  const handleMergeBatches = async () => {
    if (pickedBatches.length < 2) {
      toast.error('至少选择 2 个批次');
      return;
    }
    setMergingBatches(true);
    try {
      const res = await mergeBatches(pickedBatches, mergeName.trim() || undefined);
      toast.success(`已合并 ${pickedBatches.length} 个批次 → 「${res.name}」（${res.contactCount} 人）`);
      setPickedBatches([]);
      setMergeName('');
      setMergeMode(false);
      onBatchesChanged();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '未知错误';
      toast.error(`合并失败：${msg}`);
    } finally {
      setMergingBatches(false);
    }
  };

  // ===== 智能清洗 =====
  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const stats = await analyzePrefixes();
      setPrefixStats(stats);
      if (stats.length === 0) toast.info('未检测到名称前缀（如 yj陈铁兵 / b北京李哥）');
    } catch {
      toast.error('分析失败');
    } finally {
      setAnalyzing(false);
    }
  };

  const runClean = async (
    prefix: string,
    mode: 'strip' | 'tag',
    tagName?: string,
    dryRun?: boolean,
  ) => {
    try {
      const res = await cleanPrefix(prefix, mode, tagName, dryRun);
      if (dryRun) {
        setCleanPreview(res);
        setPendingClean({ prefix, mode, tagName });
      } else {
        toast.success(
          mode === 'strip'
            ? `已为 ${res.changed} 位联系人去掉前缀「${prefix}」`
            : `已为 ${res.changed} 位联系人打上「${tagName}」`,
        );
        setCleanPreview(null);
        setPendingClean(null);
        setPrefixStats(null);
      }
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '未知错误';
      toast.error(`操作失败：${msg}`);
    }
  };

  // ===== 重复检测 =====
  const handleDetect = async () => {
    setDupLoading(true);
    try {
      const groups = await findDuplicates();
      setDupGroups(groups);
      // 手机号组默认勾选（强判重），同名组默认不勾（同名未必同一人）
      const picked: Record<string, boolean> = {};
      const keep: Record<string, string> = {};
      groups.forEach(g => {
        picked[g.key] = g.type === 'phone';
        keep[g.key] = g.suggestedKeepId;
      });
      setPickedGroups(picked);
      setKeepChoice(keep);
      if (groups.length === 0) toast.success('未发现重复联系人，数据很干净');
    } catch {
      toast.error('检测失败');
    } finally {
      setDupLoading(false);
    }
  };

  const handleMergeContacts = async () => {
    if (!dupGroups) return;
    const groups = dupGroups
      .filter(g => pickedGroups[g.key])
      .map(g => ({
        keepId: keepChoice[g.key] || g.suggestedKeepId,
        mergeIds: g.contacts.map(c => c.id).filter(id => id !== (keepChoice[g.key] || g.suggestedKeepId)),
      }))
      .filter(g => g.mergeIds.length > 0);
    if (groups.length === 0) {
      toast.error('请先勾选要合并的分组');
      return;
    }
    setMergingContacts(true);
    try {
      const res = await mergeContacts(groups);
      toast.success(
        `已合并 ${res.mergedGroups} 组，清理 ${res.deletedContacts} 条重复记录（迁移标签 ${res.movedTags}、跟进 ${res.movedFollowups}、短信 ${res.movedMessages}、通话 ${res.movedCalls}）`,
      );
      setDupGroups(null);
      setPickedGroups({});
      onBatchesChanged();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '未知错误';
      toast.error(`合并失败：${msg}`);
    } finally {
      setMergingContacts(false);
    }
  };

  const contactLine = (c: DuplicateContact) =>
    `${c.tier ?? '-'} 层 · 标签 ${c.tagNames.length} · 跟进 ${c.followupCount} · 短信 ${c.messageCount} · 通话 ${c.callCount}`;

  // ===== 短信/通话去重 =====
  const handleCommDetect = async () => {
    setCommLoading(true);
    try {
      const res = await getCommDedupPreview();
      setCommPreview(res);
      if (res.sms.removable === 0 && res.calls.removable === 0) {
        toast.success('短信和通话都很干净，没有完全重复的记录');
      }
    } catch {
      toast.error('检测失败');
    } finally {
      setCommLoading(false);
    }
  };

  const handleCommClean = async (kind: 'sms' | 'calls') => {
    setCleaningKind(kind);
    try {
      const res = await executeCommDedup({ kind });
      toast.success(
        `已清理 ${res.deleted} 条重复${kind === 'sms' ? '短信' : '通话'}（${res.groups} 组，每组保留最早一条）`,
      );
      const next = await getCommDedupPreview();
      setCommPreview(next);
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '未知错误';
      toast.error(`清理失败：${msg}`);
    } finally {
      setCleaningKind(null);
    }
  };

  const renderCommKind = (kind: 'sms' | 'calls', icon: React.ReactNode, title: string, stat: CommDedupStat | undefined) => {
    const removable = stat?.removable ?? 0;
    return (
      <div className="rounded-lg border border-slate-200 p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
            {icon}
            {title}
            {commPreview && (
              <span className={removable > 0 ? 'text-amber-700' : 'text-emerald-600'}>
                {removable > 0 ? `${stat!.groups} 组重复，可清理 ${removable} 条` : '无重复'}
              </span>
            )}
          </div>
          {removable > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-amber-300 text-amber-800 hover:bg-amber-50"
              disabled={cleaningKind !== null}
              onClick={() => void handleCommClean(kind)}
            >
              {cleaningKind === kind ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              清理 {removable} 条
            </Button>
          )}
        </div>
        {commPreview && stat && stat.samples.length > 0 && (
          <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {stat.samples.map(s => (
              <div key={`${s.phone}-${s.firstDate}`} className="text-[11px] text-slate-500 flex items-center gap-2 min-w-0">
                <span className="font-mono text-slate-600 shrink-0">{s.phone}</span>
                <span className="text-amber-700 shrink-0">×{s.count}</span>
                <span className="text-slate-400 shrink-0">{s.firstDate}{s.lastDate !== s.firstDate ? ` ~ ${s.lastDate}` : ''}</span>
                <span className="truncate text-slate-400">{s.preview}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* ===== 批次合并 ===== */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Copy className="w-4 h-4 text-slate-500" strokeWidth={1.5} />
              碎片批次合并
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              App 分批同步会产生几十个碎片批次，合并后批次列表清爽，导出也能一次选中整批数据
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => { setMergeMode(!mergeMode); setPickedBatches([]); }}>
            {mergeMode ? '取消' : '选择批次'}
          </Button>
        </div>

        {mergeMode && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">
                已选 <span className="font-semibold text-slate-900">{pickedBatches.length}</span> / {batches.filter(b => b.status !== 'reverted').length} 个可合并批次
                {pickedBatches.length > 0 && <span className="ml-1 text-slate-400">（{batches.filter(b => pickedBatches.includes(b.id)).reduce((s, b) => s + (b.contactCount ?? 0), 0)} 人）</span>}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="px-2 py-0.5 rounded hover:bg-slate-100 text-slate-600"
                  onClick={() =>
                    setPickedBatches(batches.filter(b => b.status !== 'reverted').map(b => b.id))
                  }
                >
                  全选
                </button>
                <button
                  type="button"
                  className="px-2 py-0.5 rounded hover:bg-slate-100 text-slate-600"
                  onClick={() => setPickedBatches([])}
                >
                  清空
                </button>
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
              {batches.map((b: ImportBatch) => {
                const disabled = b.status === 'reverted';
                const picked = pickedBatches.includes(b.id);
                return (
                  <label
                    key={b.id}
                    className={`flex items-center gap-2 px-3 py-2 text-xs cursor-pointer transition-colors ${
                      disabled
                        ? 'opacity-40 cursor-not-allowed'
                        : picked
                          ? 'bg-blue-50'
                          : 'hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="accent-blue-600"
                      disabled={disabled}
                      checked={picked}
                      onChange={(e) =>
                        setPickedBatches(prev =>
                          e.target.checked ? [...prev, b.id] : prev.filter(id => id !== b.id),
                        )
                      }
                    />
                    <span className={`flex-1 truncate ${picked ? 'font-medium text-blue-900' : 'text-slate-700'}`}>{b.name}</span>
                    <span className="text-slate-400">{b.contactCount} 人</span>
                    {disabled ? (
                      <span className="text-[10px] text-slate-400">已回滚</span>
                    ) : (
                      b.deviceInfo && <span className="text-slate-300 truncate max-w-[120px]">{b.deviceInfo}</span>
                    )}
                  </label>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={mergeName}
                onChange={(e) => setMergeName(e.target.value)}
                placeholder="合并后的批次名（可选，默认沿用最早的）"
                className="h-8 text-xs flex-1 min-w-[200px]"
              />
              <Button
                size="sm"
                onClick={() => void handleMergeBatches()}
                disabled={pickedBatches.length < 2 || mergingBatches}
              >
                {mergingBatches ? <Loader2 className="w-4 h-4 animate-spin" /> : <Merge className="w-4 h-4" strokeWidth={1.5} />}
                合并 {pickedBatches.length} 个批次
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* ===== 智能清洗 ===== */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-slate-500" strokeWidth={1.5} />
              名称前缀清洗
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              识别「yj陈铁兵 / b北京李哥」这类手工前缀，可批量去掉前缀，或把前缀转成标签（先预览再执行）
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void handleAnalyze()} disabled={analyzing}>
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : '分析名称前缀'}
          </Button>
        </div>

        {prefixStats && prefixStats.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {prefixStats.map(s => (
              <div key={s.prefix} className="flex items-center gap-2 flex-wrap text-xs border border-slate-100 rounded-lg px-3 py-2">
                <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{s.prefix}</span>
                <span className="text-slate-500">{s.count} 条</span>
                <span className="text-slate-400 truncate flex-1 min-w-[120px]">{s.examples.join('、')}</span>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void runClean(s.prefix, 'strip', undefined, true)}>
                  去前缀
                </Button>
                <div className="flex items-center gap-1">
                  <Input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder="标签名"
                    className="h-7 text-xs w-24"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={!tagInput.trim()}
                    onClick={() => void runClean(s.prefix, 'tag', tagInput.trim(), true)}
                  >
                    转标签
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {cleanPreview && pendingClean && (
          <div className="mt-3 border border-amber-200 bg-amber-50 rounded-lg p-3">
            <p className="text-xs font-medium text-amber-800">
              预览：命中 {cleanPreview.matched} 条，将变更 {cleanPreview.matched - cleanPreview.skipped} 条
            </p>
            <div className="mt-2 space-y-1">
              {cleanPreview.preview.slice(0, 8).map(p => (
                <div key={p.id} className="text-xs text-slate-600 flex gap-2">
                  <span className="text-slate-400 line-through">{p.name}</span>
                  {p.newName && <span className="text-emerald-700">→ {p.newName}</span>}
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                disabled={cleaning}
                onClick={() => {
                  setCleaning(true);
                  void runClean(pendingClean.prefix, pendingClean.mode, pendingClean.tagName, false).then(() => setCleaning(false));
                }}
              >
                {cleaning ? <Loader2 className="w-4 h-4 animate-spin" /> : `确认执行（${cleanPreview.matched} 条）`}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setCleanPreview(null); setPendingClean(null); }}>
                取消
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* ===== 重复检测与确认合并 ===== */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Merge className="w-4 h-4 text-slate-500" strokeWidth={1.5} />
              重复检测与合并
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              按归一化手机号判重（去空格/+86）；同名仅作提示，同名未必同一人，需你人工确认后才合并
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void handleDetect()} disabled={dupLoading}>
            {dupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : '检测重复'}
          </Button>
        </div>

        {dupGroups && dupGroups.length > 0 && (
          <>
            <div className="mt-3 space-y-2 max-h-[420px] overflow-y-auto">
              {dupGroups.map(g => (
                <div
                  key={g.key}
                  className={`rounded-lg border p-2.5 ${g.type === 'name' ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200'}`}
                >
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={!!pickedGroups[g.key]}
                      onChange={(e) => setPickedGroups(prev => ({ ...prev, [g.key]: e.target.checked }))}
                    />
                    <span className="font-medium text-slate-700">
                      {g.type === 'phone' ? `手机号 ${g.key}` : `同名「${g.key.replace('name:', '')}」`}
                    </span>
                    {g.type === 'name' && (
                      <span className="flex items-center gap-1 text-amber-700">
                        <AlertTriangle className="w-3 h-3" strokeWidth={1.5} />
                        同名未必同一人，请人工核对
                      </span>
                    )}
                    <span className="text-slate-400">{g.contacts.length} 条</span>
                  </label>
                  <div className="mt-2 space-y-1">
                    {g.contacts.map(c => {
                      const keepId = keepChoice[g.key] || g.suggestedKeepId;
                      const isKeep = c.id === keepId;
                      return (
                        <label
                          key={c.id}
                          className={`flex items-start gap-2 text-xs px-2 py-1.5 rounded cursor-pointer ${
                            isKeep ? 'bg-emerald-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`keep-${g.key}`}
                            checked={isKeep}
                            onChange={() => setKeepChoice(prev => ({ ...prev, [g.key]: c.id }))}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-slate-800 truncate">{c.name}</span>
                              <span className="text-slate-400">{c.phone ?? '（无号码）'}</span>
                              {isKeep && <span className="text-emerald-600 text-[10px]">保留</span>}
                            </div>
                            <div className="text-slate-400 truncate">{contactLine(c)}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void handleMergeContacts()} disabled={mergingContacts}>
                {mergingContacts ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckSquare className="w-4 h-4" strokeWidth={1.5} />}
                合并选中的 {Object.values(pickedGroups).filter(Boolean).length} 组
              </Button>
              <span className="text-xs text-slate-400">
                合并后标签/跟进/短信/通话会迁移到保留记录，并写入合并日志可追溯
              </span>
            </div>
          </>
        )}
      </section>

      {/* ===== 短信/通话去重 ===== */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <MessageSquareText className="w-4 h-4 text-slate-500" strokeWidth={1.5} />
              短信 / 通话去重
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              App 重复备份会产生完全相同的记录，一键清理（每组保留最早一条，不同时间的正常记录不受影响）
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void handleCommDetect()} disabled={commLoading}>
            {commLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : '检测重复'}
          </Button>
        </div>

        {commPreview && (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {renderCommKind('sms', <MessageSquareText className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.5} />, '短信', commPreview.sms)}
            {renderCommKind('calls', <PhoneCall className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.5} />, '通话', commPreview.calls)}
          </div>
        )}
      </section>
    </div>
  );
};

export default GovernancePanel;
