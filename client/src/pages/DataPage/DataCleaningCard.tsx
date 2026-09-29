import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  Users,
  Phone,
  Layers,
  Tag,
  AlertCircle,
  CopyPlus,
  ArrowRight,
  Wand2,
  Trash2,
  RotateCcw,
  Check,
  X,
  Merge,
} from 'lucide-react';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';

import { Button } from '@client/src/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@client/src/components/ui/card';
import { Badge } from '@client/src/components/ui/badge';
import { Input } from '@client/src/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@client/src/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';

import {
  getDataQualityStats,
  getDedupPreview,
  executeDedup,
  normalizePhones,
  getTierSuggestions,
  applyTierSuggestions,
  getNicknameCleanPreview,
  executeNicknameClean,
} from '@client/src/api/data';
import type {
  DataQualityStats,
  DedupPreviewResponse,
  DataCleanDuplicateGroup,
  PhoneNormalizeResult,
  TierSuggestion,
  TierSuggestionResponse,
  NicknameCleanOperation,
  NicknameCleanOpType,
  NicknameCleanItem,
  NicknameCleanPreviewResponse,
} from '@shared/api.interface';

const OP_TYPE_LABELS: Record<NicknameCleanOpType, string> = {
  normalizeHistoryPrefix: '识别并归一化历史前缀',
  removeSpecialChars: '去特殊字符',
  searchReplace: '搜索替换',
  addPrefix: '按层级加前缀',
  generateFromNamePhone: '根据姓名手机生成',
};

const QUALITY_STATS_ITEMS: Array<{
  key: keyof DataQualityStats;
  label: string;
  icon: React.ReactNode;
  suffix?: string;
}> = [
  { key: 'totalContacts', label: '总联系人', icon: <Users className="w-4 h-4" /> },
  {
    key: 'duplicatePhoneCount',
    label: '手机号重复',
    icon: <CopyPlus className="w-4 h-4" />,
    suffix: '组',
  },
  { key: 'missingPhoneCount', label: '缺手机号', icon: <Phone className="w-4 h-4" /> },
  { key: 'missingTierCount', label: '缺层级', icon: <Layers className="w-4 h-4" /> },
  { key: 'missingTagCount', label: '缺标签', icon: <Tag className="w-4 h-4" /> },
  {
    key: 'invalidPhoneCount',
    label: '手机号格式无效',
    icon: <AlertCircle className="w-4 h-4" />,
  },
];

const DataCleaningCard: React.FC = () => {
  // --- 1. Data Quality ---
  const [qualityLoading, setQualityLoading] = useState<boolean>(false);
  const [qualityStats, setQualityStats] = useState<DataQualityStats | null>(null);

  const handleDetectQuality = async (): Promise<void> => {
    try {
      setQualityLoading(true);
      const stats: DataQualityStats = await getDataQualityStats();
      setQualityStats(stats);
    } catch (error) {
      logger.error('检测数据质量失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`检测数据质量失败：${msg}`);
    } finally {
      setQualityLoading(false);
    }
  };

  // --- 2. Dedup ---
  const [dedupLoading, setDedupLoading] = useState<boolean>(false);
  const [dedupData, setDedupData] = useState<DedupPreviewResponse | null>(null);
  const [dedupMerging, setDedupMerging] = useState<boolean>(false);
  const [dedupMergePhoneOpen, setDedupMergePhoneOpen] = useState<boolean>(false);
  const [mergingGroupKey, setMergingGroupKey] = useState<string | null>(null);
  const [ignoredGroupKeys, setIgnoredGroupKeys] = useState<Set<string>>(new Set());

  const handleDetectDedup = async (): Promise<void> => {
    try {
      setDedupLoading(true);
      const data: DedupPreviewResponse = await getDedupPreview();
      setDedupData(data);
    } catch (error) {
      logger.error('检测重复联系人失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`检测重复联系人失败：${msg}`);
    } finally {
      setDedupLoading(false);
    }
  };

  const getKeepId = (group: DataCleanDuplicateGroup): string => {
    const bestIdx = group.contacts.reduce(
      (bestIdx: number, c, idx: number) =>
        c.infoScore > group.contacts[bestIdx].infoScore ? idx : bestIdx,
      0
    );
    return group.contacts[bestIdx]?.id ?? group.contacts[0]?.id ?? '';
  };

  const getKeepName = (group: DataCleanDuplicateGroup): string => {
    const bestIdx = group.contacts.reduce(
      (bestIdx: number, c, idx: number) =>
        c.infoScore > group.contacts[bestIdx].infoScore ? idx : bestIdx,
      0
    );
    return group.contacts[bestIdx]?.name ?? group.contacts[0]?.name ?? '';
  };

  const buildGroupsPayload = (
    groups: DataCleanDuplicateGroup[]
  ): Array<{ groupKey: string; keepId: string; mergeIds: string[] }> => {
    return groups.map((g: DataCleanDuplicateGroup) => {
      const keepId = getKeepId(g);
      return {
        groupKey: g.groupKey,
        keepId,
        mergeIds: g.contacts.map((c) => c.id).filter((id: string) => id !== keepId),
      };
    });
  };

  const phoneGroups = useMemo(
    () =>
      dedupData?.groups.filter(
        (g: DataCleanDuplicateGroup) => g.matchField === 'phone' && !ignoredGroupKeys.has(g.groupKey)
      ) ?? [],
    [dedupData, ignoredGroupKeys]
  );

  const nameGroups = useMemo(
    () =>
      dedupData?.groups.filter(
        (g: DataCleanDuplicateGroup) => g.matchField === 'name' && !ignoredGroupKeys.has(g.groupKey)
      ) ?? [],
    [dedupData, ignoredGroupKeys]
  );

  const handleMergeGroup = async (group: DataCleanDuplicateGroup): Promise<void> => {
    setMergingGroupKey(group.groupKey);
    try {
      await executeDedup({ groups: buildGroupsPayload([group]) });
      toast.success('已合并 1 组重复联系人');
      setIgnoredGroupKeys((prev: Set<string>) => new Set(prev).add(group.groupKey));
    } catch (error) {
      logger.error('合并重复联系人失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`合并失败：${msg}`);
    } finally {
      setMergingGroupKey(null);
    }
  };

  const handleIgnoreGroup = (group: DataCleanDuplicateGroup): void => {
    setIgnoredGroupKeys((prev: Set<string>) => {
      const next = new Set(prev);
      next.add(group.groupKey);
      return next;
    });
  };

  const handleMergeAllPhone = async (): Promise<void> => {
    if (phoneGroups.length === 0) return;
    setDedupMerging(true);
    try {
      const result = await executeDedup({
        groups: buildGroupsPayload(phoneGroups),
      });
      toast.success(`已合并 ${result.mergedGroups} 组同手机号联系人`);
      const phoneKeys = new Set(phoneGroups.map((g: DataCleanDuplicateGroup) => g.groupKey));
      setIgnoredGroupKeys((prev: Set<string>) => {
        const next = new Set(prev);
        phoneKeys.forEach((k: string) => next.add(k));
        return next;
      });
      setDedupMergePhoneOpen(false);
    } catch (error) {
      logger.error('批量合并同手机号失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`批量合并失败：${msg}`);
    } finally {
      setDedupMerging(false);
    }
  };

  // --- 3. Phone Normalize ---
  const [normalizeLoading, setNormalizeLoading] = useState<boolean>(false);
  const [normalizeResult, setNormalizeResult] =
    useState<PhoneNormalizeResult | null>(null);

  const handleNormalizePhones = async (): Promise<void> => {
    try {
      setNormalizeLoading(true);
      const result: PhoneNormalizeResult = await normalizePhones();
      setNormalizeResult(result);
      toast.success(`已标准化 ${result.updated} 条手机号`);
    } catch (error) {
      logger.error('手机号标准化失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`手机号标准化失败：${msg}`);
    } finally {
      setNormalizeLoading(false);
    }
  };

  // --- 4. Tier Suggestions ---
  const [tierLoading, setTierLoading] = useState<boolean>(false);
  const [tierData, setTierData] = useState<TierSuggestionResponse | null>(null);
  const [tierApplyingId, setTierApplyingId] = useState<string | null>(null);
  const [tierApplyingAll, setTierApplyingAll] = useState<boolean>(false);
  const [tierApplyAllOpen, setTierApplyAllOpen] = useState<boolean>(false);

  const handleGetTierSuggestions = async (): Promise<void> => {
    try {
      setTierLoading(true);
      const data: TierSuggestionResponse = await getTierSuggestions();
      setTierData(data);
    } catch (error) {
      logger.error('获取分层建议失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`获取分层建议失败：${msg}`);
    } finally {
      setTierLoading(false);
    }
  };

  const handleApplyTier = async (s: TierSuggestion): Promise<void> => {
    setTierApplyingId(s.id);
    try {
      await applyTierSuggestions({ contactIds: [s.id] });
      toast.success('已应用分层建议');
      setTierData((prev: TierSuggestionResponse | null) => {
        if (!prev) return prev;
        return {
          ...prev,
          suggestions: prev.suggestions.filter(
            (item: TierSuggestion) => item.id !== s.id
          ),
          total: prev.total - 1,
        };
      });
    } catch (error) {
      logger.error('应用分层建议失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`应用失败：${msg}`);
    } finally {
      setTierApplyingId(null);
    }
  };

  const handleApplyAllTier = async (): Promise<void> => {
    if (!tierData || tierData.suggestions.length === 0) return;
    setTierApplyingAll(true);
    try {
      const ids = tierData.suggestions.map((s: TierSuggestion) => s.id);
      await applyTierSuggestions({ contactIds: ids });
      toast.success(`已应用 ${ids.length} 条分层建议`);
      setTierData({ suggestions: [], total: 0 });
      setTierApplyAllOpen(false);
    } catch (error) {
      logger.error('批量应用分层建议失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`批量应用失败：${msg}`);
    } finally {
      setTierApplyingAll(false);
    }
  };

  // --- 5. Nickname Clean ---
  const [operations, setOperations] = useState<NicknameCleanOperation[]>([]);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewData, setPreviewData] =
    useState<NicknameCleanPreviewResponse | null>(null);
  const [executing, setExecuting] = useState<boolean>(false);
  const [execDialogOpen, setExecDialogOpen] = useState<boolean>(false);

  const addOperation = (type: NicknameCleanOpType): void => {
    const newOp: NicknameCleanOperation = { type };
    if (type === 'searchReplace') {
      newOp.from = '';
      newOp.to = '';
    }
    if (type === 'addPrefix') {
      newOp.separator = '·';
    }
    setOperations((prev: NicknameCleanOperation[]) => [...prev, newOp]);
    setPreviewData(null);
  };

  const removeOperation = (index: number): void => {
    setOperations((prev: NicknameCleanOperation[]) =>
      prev.filter((_: NicknameCleanOperation, i: number) => i !== index)
    );
    setPreviewData(null);
  };

  const updateOperation = (
    index: number,
    patch: Partial<NicknameCleanOperation>
  ): void => {
    setOperations((prev: NicknameCleanOperation[]) =>
      prev.map(
        (op: NicknameCleanOperation, i: number) =>
          i === index ? { ...op, ...patch } : op
      )
    );
    setPreviewData(null);
  };

  const handlePreview = async (): Promise<void> => {
    if (operations.length === 0) {
      toast.error('请先添加至少一个操作');
      return;
    }
    try {
      setPreviewLoading(true);
      const data: NicknameCleanPreviewResponse = await getNicknameCleanPreview({
        operations,
      });
      setPreviewData(data);
    } catch (error) {
      logger.error('获取预览失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`获取预览失败：${msg}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleExecute = async (): Promise<void> => {
    if (!previewData || previewData.items.length === 0) return;
    setExecuting(true);
    try {
      const result = await executeNicknameClean({ items: previewData.items });
      toast.success(`已更新 ${result.updated} 条，已自动备份`);
      setPreviewData(null);
      setOperations([]);
      setExecDialogOpen(false);
    } catch (error) {
      logger.error('执行清洗失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`执行清洗失败：${msg}`);
    } finally {
      setExecuting(false);
    }
  };

  const handleReset = (): void => {
    setOperations([]);
    setPreviewData(null);
  };

  return (
    <Card className="border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-5 h-5" style={{ strokeWidth: 1.5 }} />
          </div>
          <div className="flex-1">
            <CardTitle className="text-lg font-semibold">数据清洗</CardTitle>
            <CardDescription className="text-sm text-slate-500 mt-1">
              检测数据质量问题，批量清洗备注名、手机号、去重等
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 1. 数据质量概览 */}
        <div className="rounded-md border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium">数据质量概览</h4>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleDetectQuality()}
              disabled={qualityLoading}
              className="h-8"
            >
              {qualityLoading ? '检测中...' : '检测数据质量'}
            </Button>
          </div>
          {qualityStats ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {QUALITY_STATS_ITEMS.map(
                (item: {
                  key: keyof DataQualityStats;
                  label: string;
                  icon: React.ReactNode;
                  suffix?: string;
                }) => (
                  <div
                    key={item.key}
                    className="rounded-md border border-border p-3 bg-white"
                  >
                    <div className="flex items-center gap-1.5 text-slate-400 mb-1">
                      {item.icon}
                      <span className="text-xs">{item.label}</span>
                    </div>
                    <p className="text-xl font-semibold text-slate-800">
                      {qualityStats[item.key]}
                      {item.suffix && (
                        <span className="text-sm font-normal text-slate-400 ml-1">
                          {item.suffix}
                        </span>
                      )}
                    </p>
                  </div>
                )
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400 text-center py-4">
              点击上方按钮检测数据质量
            </p>
          )}
        </div>

        {/* 2. 去重合并 */}
        <div className="rounded-md border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium">去重合并</h4>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleDetectDedup()}
              disabled={dedupLoading}
              className="h-8"
            >
              {dedupLoading ? '检测中...' : '检测重复联系人'}
            </Button>
          </div>
          {dedupData ? (
            <div className="space-y-4">
              {phoneGroups.length === 0 && nameGroups.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-2">
                  未发现重复联系人
                </p>
              ) : (
                <>
                  {/* 手机号重复组 */}
                  {phoneGroups.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] h-5 border-emerald-200 bg-emerald-50 text-emerald-700">
                            <Phone className="w-3 h-3 mr-1" strokeWidth={1.5} />
                            同手机号自动合并
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {phoneGroups.length} 组
                          </span>
                        </div>
                        {phoneGroups.length > 1 && (
                          <AlertDialog
                            open={dedupMergePhoneOpen}
                            onOpenChange={setDedupMergePhoneOpen}
                          >
                            <AlertDialogTrigger asChild>
                              <Button variant="outline" size="sm" className="h-7 text-xs">
                                <Merge className="w-3.5 h-3.5 mr-1" />
                                全部合并同号
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>确认合并全部同手机号</AlertDialogTitle>
                                <AlertDialogDescription>
                                  将合并 {phoneGroups.length} 组同手机号重复联系人，
                                  每组保留信息最完整的联系人。此操作不可撤销。
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>取消</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => void handleMergeAllPhone()}
                                  disabled={dedupMerging}
                                >
                                  {dedupMerging ? '合并中...' : '确认合并'}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                      <div className="space-y-2 max-h-52 overflow-y-auto">
                        {phoneGroups.map((group: DataCleanDuplicateGroup) => (
                          <div
                            key={group.groupKey}
                            className="rounded-md border border-border p-3 bg-white"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-700 font-mono">
                                  {group.matchValue}
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5 truncate">
                                  {group.contacts.map((c) => c.name).join('、')}
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5">
                                  建议保留：
                                  <span className="text-emerald-600">
                                    {getKeepName(group)}
                                  </span>
                                </p>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleMergeGroup(group)}
                                disabled={mergingGroupKey === group.groupKey}
                                className="h-7 text-xs flex-shrink-0"
                              >
                                {mergingGroupKey === group.groupKey ? '合并中...' : '合并'}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 姓名相似组 */}
                  {nameGroups.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] h-5 border-amber-200 bg-amber-50 text-amber-700">
                          <AlertCircle className="w-3 h-3 mr-1" strokeWidth={1.5} />
                          疑似同名
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {nameGroups.length} 组，请手动确认
                        </span>
                      </div>
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {nameGroups.map((group: DataCleanDuplicateGroup) => (
                          <div
                            key={group.groupKey}
                            className="rounded-md border border-amber-200 p-3 bg-amber-50/40"
                          >
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-700">
                                  {group.matchValue}
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5 truncate">
                                  {group.contacts.map((c) => c.name).join('、')}
                                </p>
                              </div>
                            </div>
                            <div className="space-y-1 mb-2">
                              {group.contacts.map((c) => (
                                <div
                                  key={c.id}
                                  className="text-xs text-slate-600 flex items-center justify-between bg-white/60 rounded px-2 py-1.5"
                                >
                                  <span className="truncate">{c.name}</span>
                                  <span className="text-muted-foreground flex items-center gap-2 flex-shrink-0">
                                    {c.phone && <Phone className="w-3 h-3" />}
                                    {c.phone && <span className="font-mono">{c.phone}</span>}
                                    <span className="text-slate-400">
                                      信息分 {c.infoScore}
                                    </span>
                                  </span>
                                </div>
                              ))}
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleIgnoreGroup(group)}
                                className="h-7 text-xs text-slate-500 hover:text-slate-700"
                              >
                                <X className="w-3.5 h-3.5 mr-1" />
                                忽略
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleMergeGroup(group)}
                                disabled={mergingGroupKey === group.groupKey}
                                className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-100 hover:text-amber-800"
                              >
                                {mergingGroupKey === group.groupKey ? '合并中...' : '确认合并'}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400 text-center py-4">
              点击上方按钮检测重复联系人
            </p>
          )}
        </div>

        {/* 3. 手机号标准化 */}
        <div className="rounded-md border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium">手机号标准化</h4>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleNormalizePhones()}
              disabled={normalizeLoading}
              className="h-8"
            >
              {normalizeLoading ? '处理中...' : '一键标准化手机号'}
            </Button>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            去掉空格、横线、+86 前缀等，统一为 11 位数字
          </p>
          {normalizeResult ? (
            <div className="space-y-2">
              <div className="flex gap-4 text-sm">
                <span className="text-slate-500">
                  已更新：
                  <span className="text-emerald-600 font-medium">
                    {normalizeResult.updated}
                  </span>{' '}
                  条
                </span>
                <span className="text-slate-500">
                  无效：
                  <span className="text-amber-600 font-medium">
                    {normalizeResult.invalidCount}
                  </span>{' '}
                  条
                </span>
              </div>
              {normalizeResult.invalidContacts.length > 0 && (
                <div className="rounded-md border border-border bg-slate-50 p-3 max-h-40 overflow-y-auto">
                  <p className="text-xs text-slate-500 mb-2">无效手机号列表：</p>
                  <div className="space-y-1">
                    {normalizeResult.invalidContacts.map(
                      (c: { id: string; name: string; phone: string }) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between text-xs"
                        >
                          <span className="text-slate-600 truncate">{c.name}</span>
                          <span className="text-amber-600 font-mono">{c.phone}</span>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400 text-center py-2">
              尚未执行标准化
            </p>
          )}
        </div>

        {/* 4. 智能分层建议 */}
        <div className="rounded-md border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium">智能分层建议</h4>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleGetTierSuggestions()}
              disabled={tierLoading}
              className="h-8"
            >
              {tierLoading ? '分析中...' : '获取分层建议'}
            </Button>
          </div>
          {tierData ? (
            <div className="space-y-3">
              {tierData.suggestions.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-2">
                  暂无分层建议
                </p>
              ) : (
                <>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {tierData.suggestions.map((s: TierSuggestion) => (
                      <div
                        key={s.id}
                        className="rounded-md border border-border p-3 bg-white"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-medium text-slate-700 truncate">
                                {s.name}
                              </span>
                              <span className="text-xs text-slate-400 flex items-center gap-1">
                                <span className="px-1.5 py-0.5 rounded bg-slate-100">
                                  {s.currentTier}
                                </span>
                                <ArrowRight
                                  className="w-3 h-3"
                                  style={{ strokeWidth: 1.5 }}
                                />
                                <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">
                                  {s.suggestedTier}
                                </span>
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-1 truncate">
                              {s.reason}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleApplyTier(s)}
                            disabled={tierApplyingId === s.id}
                            className="h-7 text-xs flex-shrink-0"
                          >
                            {tierApplyingId === s.id ? '应用中...' : '应用'}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {tierData.suggestions.length > 1 && (
                    <AlertDialog
                      open={tierApplyAllOpen}
                      onOpenChange={setTierApplyAllOpen}
                    >
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="w-full h-8">
                          全部应用（{tierData.suggestions.length} 条）
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>确认应用全部建议</AlertDialogTitle>
                          <AlertDialogDescription>
                            将为 {tierData.suggestions.length} 个联系人应用分层建议。
                            此操作不可撤销。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => void handleApplyAllTier()}
                            disabled={tierApplyingAll}
                          >
                            {tierApplyingAll ? '应用中...' : '确认应用'}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400 text-center py-4">
              点击上方按钮获取分层建议
            </p>
          )}
        </div>

        {/* 5. 备注名批量清洗 */}
        <div className="rounded-md border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium">备注名批量清洗</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="h-8 text-slate-400 hover:text-slate-600"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              重置
            </Button>
          </div>

          {/* 操作列表 */}
          <div className="space-y-2 mb-3">
            {operations.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-3 border border-dashed border-border rounded-md">
                暂无操作，点击下方按钮添加
              </p>
            ) : (
              operations.map(
                (op: NicknameCleanOperation, index: number) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 p-2 rounded-md border border-border bg-white"
                  >
                    <span className="text-xs text-slate-400 w-5 text-center">
                      {index + 1}
                    </span>
                    <span className="text-sm text-slate-600 flex-1 truncate">
                      {OP_TYPE_LABELS[op.type] || op.type}
                    </span>
                    {op.type === 'searchReplace' && (
                      <>
                        <Input
                          value={op.from || ''}
                          onChange={(
                            e: React.ChangeEvent<HTMLInputElement>
                          ) =>
                            updateOperation(index, { from: e.target.value })
                          }
                          placeholder="查找"
                          className="h-7 w-20 text-xs"
                        />
                        <span className="text-slate-300">→</span>
                        <Input
                          value={op.to || ''}
                          onChange={(
                            e: React.ChangeEvent<HTMLInputElement>
                          ) =>
                            updateOperation(index, { to: e.target.value })
                          }
                          placeholder="替换为"
                          className="h-7 w-20 text-xs"
                        />
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeOperation(index)}
                      className="h-7 w-7 p-0 text-slate-300 hover:text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )
              )
            )}
          </div>

          {/* 添加操作 */}
          <div className="mb-4">
            <Select
              onValueChange={(val: string) => {
                if (val) {
                  addOperation(val as NicknameCleanOpType);
                }
              }}
              value=""
            >
              <SelectTrigger className="w-full h-8 text-xs">
                <SelectValue placeholder="+ 添加操作" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normalizeHistoryPrefix">
                  识别并归一化历史前缀（A·a 等）
                </SelectItem>
                <SelectItem value="removeSpecialChars">去特殊字符</SelectItem>
                <SelectItem value="searchReplace">搜索替换</SelectItem>
                <SelectItem value="addPrefix">按层级加前缀</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 预览 + 执行按钮 */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handlePreview()}
              disabled={previewLoading || operations.length === 0}
              className="flex-1 h-8"
            >
              <Wand2 className="w-3.5 h-3.5 mr-1" />
              {previewLoading ? '预览中...' : '预览清洗效果'}
            </Button>
            <AlertDialog
              open={execDialogOpen}
              onOpenChange={setExecDialogOpen}
            >
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  disabled={
                    !previewData ||
                    previewData.items.length === 0 ||
                    executing
                  }
                  className="flex-1 h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Check className="w-3.5 h-3.5 mr-1" />
                  执行清洗
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认执行清洗</AlertDialogTitle>
                  <AlertDialogDescription>
                    将更新{' '}
                    <strong>{previewData?.items.length ?? 0}</strong>{' '}
                    条备注名，执行前将自动备份。此操作不可撤销。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => void handleExecute()}
                    disabled={executing}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {executing ? '执行中...' : '确认执行'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {/* 预览结果 */}
          {previewData && (
            <div className="mt-4 rounded-md border border-border overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 border-b border-border">
                <p className="text-xs text-slate-500">
                  共 {previewData.items.length} 条
                  {previewData.items.length > 20 && '，仅显示前 20 条'}
                </p>
              </div>
              {previewData.items.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">
                  没有需要清洗的备注名
                </p>
              ) : (
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 w-1/2">
                          原名
                        </th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 w-1/2">
                          新名
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.items.slice(0, 20).map(
                        (item: NicknameCleanItem) => (
                          <tr
                            key={item.contactId}
                            className="border-t border-border"
                          >
                            <td className="px-3 py-2 text-xs text-slate-500 truncate max-w-0">
                              {item.oldName || <span className="text-slate-300">（空）</span>}
                            </td>
                            <td className="px-3 py-2 text-xs text-emerald-600 truncate max-w-0">
                              {item.newName || <span className="text-slate-300">（空）</span>}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default DataCleaningCard;
