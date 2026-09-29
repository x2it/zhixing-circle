import React, { useState, useEffect } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Palette,
  Layers,
  Tag as TagIcon,
  Check,
  X,
  ChevronUp,
  ChevronDown,
  Eye,
  Copy,
  RotateCcw,
  History,
} from 'lucide-react';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';

import { Button } from '@client/src/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@client/src/components/ui/card';
import { Input } from '@client/src/components/ui/input';
import { Label } from '@client/src/components/ui/label';
import { Badge } from '@client/src/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@client/src/components/ui/tabs';
import { Switch } from '@client/src/components/ui/switch';

import {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  applyTemplate,
  duplicateTemplate,
  resetTemplate,
  resetAllTemplates,
} from '@client/src/api/templates';
import type {
  ContactTemplate,
  TemplateTier,
  TemplateTag,
  NicknameFormatConfig,
  CreateTemplateRequest,
  TemplateField,
} from '@shared/api.interface';

const PRESET_COLORS: string[] = [
  '#dc2626',
  '#d97706',
  '#16a34a',
  '#2563eb',
  '#db2777',
  '#64748b',
  '#0891b2',
];

const defaultTiers: TemplateTier[] = [
  { value: 'S', label: 'S级', description: '核心客户', color: '#0f172a', sortOrder: 0 },
  { value: 'A', label: 'A级', description: '重要客户', color: '#1e293b', sortOrder: 1 },
  { value: 'B', label: 'B级', description: '一般客户', color: '#334155', sortOrder: 2 },
  { value: 'C', label: 'C级', description: '普通客户', color: '#64748b', sortOrder: 3 },
  { value: 'D', label: 'D级', description: '待激活', color: '#94a3b8', sortOrder: 4 },
  { value: 'V', label: 'V级', description: 'VIP/特殊关系', color: '#059669', sortOrder: 5 },
];

// 中性默认标签：不预设行业（房产/保险等场景请基于对应预设模板「另存为新方案」）
const defaultIdentityTags: TemplateTag[] = [
  { name: '朋友', color: '#2563eb', sortOrder: 0 },
  { name: '同事', color: '#64748b', sortOrder: 1 },
  { name: '同学', color: '#8b5cf6', sortOrder: 2 },
  { name: '重要客户', color: '#dc2626', sortOrder: 3 },
  { name: '普通联系人', color: '#94a3b8', sortOrder: 4 },
];

const defaultAttributeTags: TemplateTag[] = [
  { name: '待跟进', color: '#d97706', sortOrder: 0 },
  { name: '重点', color: '#dc2626', sortOrder: 1 },
  { name: '可合作', color: '#16a34a', sortOrder: 2 },
];

const defaultNicknameFormat: NicknameFormatConfig = {
  description: '默认备注名格式',
  useTierPrefix: true,
  tierSeparator: '·',
  useKeyInfoBrackets: true,
  nonClientPrefixes: [
    { prefix: 'X', label: '非客户' },
  ],
  relationSuffixes: [
    { suffix: '姐', label: '姐' },
    { suffix: '哥', label: '哥' },
    { suffix: '总', label: '总' },
  ],
  examples: ['S·张三【刚需】', 'A·李四姐【改善】', 'X·王五'],
};

const TemplatesPage: React.FC = () => {
  const [templates, setTemplates] = useState<ContactTemplate[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editingTemplate, setEditingTemplate] = useState<ContactTemplate | null>(null);
  const [activeTab, setActiveTab] = useState<string>('tiers');

  const [formData, setFormData] = useState<CreateTemplateRequest>({
    name: '',
    description: '',
    tiers: defaultTiers,
    identityTags: defaultIdentityTags,
    attributeTags: defaultAttributeTags,
    nicknameFormat: defaultNicknameFormat,
  });
  const [previewTemplate, setPreviewTemplate] = useState<ContactTemplate | null>(null);
  const [resetAllOpen, setResetAllOpen] = useState<boolean>(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getTemplates();
      setTemplates(data);
      // 「当前使用」以服务端为准：换设备、App 端拉取都能看到同一个结果，
      // 不再依赖浏览器 localStorage（历史实现里它经常是空的，导致完全看不出在用哪个）
      const active = data.find((t: ContactTemplate) => t.isActive);
      setActiveTemplateId(active?.id ?? null);
    } catch (error) {
      logger.error('加载模板失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`加载失败：${msg}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // 兼容旧版本：历史把「当前模板」存在浏览器本地，迁移到服务端后清理掉，
    // 避免本地残留与服务端权威值不一致造成困惑
    localStorage.removeItem('active_template');
  }, []);

  const handleOpenAdd = () => {
    setEditingTemplate(null);
    setFormData({
      name: '',
      description: '',
      tiers: defaultTiers.map((t: TemplateTier) => ({ ...t })),
      identityTags: defaultIdentityTags.map((t: TemplateTag) => ({ ...t })),
      attributeTags: defaultAttributeTags.map((t: TemplateTag) => ({ ...t })),
      nicknameFormat: { ...defaultNicknameFormat },
    });
    setActiveTab('tiers');
    setDialogOpen(true);
  };

  const handleOpenEdit = (template: ContactTemplate) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      description: template.description,
      tiers: template.tiers.map((t: TemplateTier) => ({ ...t })),
      identityTags: template.identityTags.map((t: TemplateTag) => ({ ...t })),
      attributeTags: template.attributeTags.map((t: TemplateTag) => ({ ...t })),
      nicknameFormat: { ...template.nicknameFormat },
    });
    setActiveTab('tiers');
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast.error('请输入模板名称');
      return;
    }
    if (formData.tiers.length === 0) {
      toast.error('至少需要一个层级');
      return;
    }
    try {
      if (editingTemplate) {
        await updateTemplate(editingTemplate.id, formData);
        toast.success('模板已更新');
      } else {
        await createTemplate(formData);
        toast.success('模板已创建');
      }
      setDialogOpen(false);
      loadData();
    } catch (error) {
      logger.error('保存模板失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`保存失败：${msg}`);
    }
  };

  const handleDelete = async (template: ContactTemplate) => {
    try {
      await deleteTemplate(template.id);
      toast.success(`已删除模板"${template.name}"`);
      // 服务端会同步清掉「当前使用」标记，重新拉取即可
      await loadData();
    } catch (error) {
      logger.error('删除模板失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`删除失败：${msg}`);
    }
  };

  const handleApply = async (template: ContactTemplate) => {
    try {
      await applyTemplate(template.id);
      // 服务端已记录「当前使用」，重新拉取即可拿到权威状态
      await loadData();
      toast.success(`已切换到 ${template.name} 模板`);
    } catch (error) {
      logger.error('应用模板失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`应用失败：${msg}`);
    }
  };

  /** 另存为新方案：复制一份到自己名下随意改，预设模板不受影响 */
  const handleDuplicate = async (template: ContactTemplate) => {
    try {
      const created = await duplicateTemplate(template.id);
      await loadData();
      toast.success(`已另存为新方案"${created.name}"，可放心修改，随时可一键重置回初始内容`);
    } catch (error) {
      logger.error('另存为新方案失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`另存失败：${msg}`);
    }
  };

  /** 重置自定义方案：恢复为「另存那一刻」的初始内容 */
  const handleReset = async (template: ContactTemplate) => {
    try {
      await resetTemplate(template.id);
      await loadData();
      toast.success(`已把"${template.name}"重置为初始内容`);
    } catch (error) {
      logger.error('重置方案失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`重置失败：${msg}`);
    }
  };

  /** 恢复出厂：删除全部自定义方案 + 重置生效配置（联系人/标签数据不受影响） */
  const handleResetAll = async () => {
    try {
      const result = await resetAllTemplates();
      await loadData();
      toast.success(
        result.removedTemplates > 0
          ? `已恢复出厂：清除 ${result.removedTemplates} 个自定义方案，分层与昵称配置已重置`
          : '已恢复出厂：分层与昵称配置已重置（没有可清除的自定义方案）',
      );
    } catch (error) {
      logger.error('恢复出厂失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`恢复出厂失败：${msg}`);
    } finally {
      setResetAllOpen(false);
    }
  };

  // --- Tiers helpers ---
  const addTier = () => {
    const newTier: TemplateTier = {
      value: `T${formData.tiers.length + 1}`,
      label: `新层级${formData.tiers.length + 1}`,
      description: '',
      color: PRESET_COLORS[formData.tiers.length % PRESET_COLORS.length],
      sortOrder: formData.tiers.length,
    };
    setFormData({ ...formData, tiers: [...formData.tiers, newTier] });
  };

  const updateTier = (index: number, patch: Partial<TemplateTier>) => {
    const newTiers = [...formData.tiers];
    newTiers[index] = { ...newTiers[index], ...patch };
    setFormData({ ...formData, tiers: newTiers });
  };

  const removeTier = (index: number) => {
    if (formData.tiers.length <= 1) {
      toast.error('至少保留一个层级');
      return;
    }
    const newTiers = formData.tiers
      .filter((_: TemplateTier, i: number) => i !== index)
      .map((t: TemplateTier, i: number) => ({ ...t, sortOrder: i }));
    setFormData({ ...formData, tiers: newTiers });
  };

  const moveTier = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= formData.tiers.length) return;
    const newTiers = [...formData.tiers];
    [newTiers[index], newTiers[newIndex]] = [newTiers[newIndex], newTiers[index]];
    newTiers.forEach((t: TemplateTier, i: number) => {
      t.sortOrder = i;
    });
    setFormData({ ...formData, tiers: newTiers });
  };

  // --- Tags helpers ---
  const addTag = (category: 'identity' | 'attribute') => {
    const list = category === 'identity' ? formData.identityTags : formData.attributeTags;
    const newTag: TemplateTag = {
      name: '新标签',
      color: PRESET_COLORS[list.length % PRESET_COLORS.length],
      sortOrder: list.length,
    };
    const newList = [...list, newTag];
    if (category === 'identity') {
      setFormData({ ...formData, identityTags: newList });
    } else {
      setFormData({ ...formData, attributeTags: newList });
    }
  };

  const updateTag = (
    category: 'identity' | 'attribute',
    index: number,
    patch: Partial<TemplateTag>,
  ) => {
    const list = category === 'identity' ? [...formData.identityTags] : [...formData.attributeTags];
    list[index] = { ...list[index], ...patch };
    if (category === 'identity') {
      setFormData({ ...formData, identityTags: list });
    } else {
      setFormData({ ...formData, attributeTags: list });
    }
  };

  const removeTag = (category: 'identity' | 'attribute', index: number) => {
    const list = category === 'identity' ? formData.identityTags : formData.attributeTags;
    const newList = list
      .filter((_: TemplateTag, i: number) => i !== index)
      .map((t: TemplateTag, i: number) => ({ ...t, sortOrder: i }));
    if (category === 'identity') {
      setFormData({ ...formData, identityTags: newList });
    } else {
      setFormData({ ...formData, attributeTags: newList });
    }
  };

  // --- Nickname format helpers ---
  const updateNickname = (patch: Partial<NicknameFormatConfig>) => {
    setFormData({ ...formData, nicknameFormat: { ...formData.nicknameFormat, ...patch } });
  };

  const refreshExamples = () => {
    const { useTierPrefix, tierSeparator, useKeyInfoBrackets } = formData.nicknameFormat;
    const tier = formData.tiers[0]?.value ?? 'S';
    const tag = formData.attributeTags[0]?.name ?? '刚需';
    const name = '张三';
    let example1 = name;
    if (useTierPrefix) example1 = `${tier}${tierSeparator}${example1}`;
    if (useKeyInfoBrackets) example1 = `${example1}【${tag}】`;
    let example2 = '李四姐';
    if (useTierPrefix) example2 = `${formData.tiers[1]?.value ?? 'A'}${tierSeparator}${example2}`;
    const nonClient = formData.nicknameFormat.nonClientPrefixes[0]?.prefix ?? 'X';
    const example3 = `${nonClient}${tierSeparator}王五`;
    updateNickname({ examples: [example1, example2, example3] });
  };

  const updateNonClientPrefix = (index: number, patch: { prefix?: string; label?: string }) => {
    const newList = [...formData.nicknameFormat.nonClientPrefixes];
    newList[index] = { ...newList[index], ...patch };
    updateNickname({ nonClientPrefixes: newList });
  };

  const addNonClientPrefix = () => {
    updateNickname({
      nonClientPrefixes: [
        ...formData.nicknameFormat.nonClientPrefixes,
        { prefix: 'X', label: '非客户' },
      ],
    });
  };

  const removeNonClientPrefix = (index: number) => {
    updateNickname({
      nonClientPrefixes: formData.nicknameFormat.nonClientPrefixes.filter(
        (_: { prefix: string; label: string }, i: number) => i !== index,
      ),
    });
  };

  const updateRelationSuffix = (index: number, patch: { suffix?: string; label?: string }) => {
    const newList = [...formData.nicknameFormat.relationSuffixes];
    newList[index] = { ...newList[index], ...patch };
    updateNickname({ relationSuffixes: newList });
  };

  const addRelationSuffix = () => {
    updateNickname({
      relationSuffixes: [
        ...formData.nicknameFormat.relationSuffixes,
        { suffix: '老师', label: '老师' },
      ],
    });
  };

  const removeRelationSuffix = (index: number) => {
    updateNickname({
      relationSuffixes: formData.nicknameFormat.relationSuffixes.filter(
        (_: { suffix: string; label: string }, i: number) => i !== index,
      ),
    });
  };

  if (loading && templates.length === 0) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">模板方案</h2>
            <p className="text-sm text-slate-600 mt-1">加载中...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-5" data-ai-section-type="card-list">
      {/* 页面标题 + 新增按钮 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-medium text-foreground">模板方案</h2>
          <p className="text-sm text-muted-foreground mt-1">
            选择或自定义人脉分层与标签体系
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AlertDialog open={resetAllOpen} onOpenChange={setResetAllOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive border-destructive/40">
                <History className="w-4 h-4" strokeWidth={1.5} />
                恢复出厂
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认恢复出厂设置？</AlertDialogTitle>
                <AlertDialogDescription>
                  将删除你的全部自定义方案，并把分层与昵称格式重置为系统默认（S/A/B/C/D/V）。
                  <br />
                  <span className="text-foreground font-medium">
                    联系人、沟通记录和已有标签不受影响，仅模板配置会重置。
                  </span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  onClick={handleResetAll}
                >
                  确认恢复出厂
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button onClick={handleOpenAdd}>
            <Plus className="w-4 h-4" strokeWidth={1.5} />
            新建模板
          </Button>
        </div>
      </div>

      {/* 模板卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map((template: ContactTemplate) => {
          const isActive = activeTemplateId === template.id;
          return (
            <Card
              key={template.id}
              className={`border shadow-none transition-colors duration-150 ${
                isActive
                  ? 'border-primary/50 bg-primary/[0.04] ring-2 ring-primary/25'
                  : 'border-border hover:border-primary/30'
              }`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base font-medium">
                      {template.name}
                    </CardTitle>
                    {isActive && (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                        <Check className="w-3 h-3" strokeWidth={2} />
                        使用中
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Badge variant={template.isPreset ? 'secondary' : 'outline'}>
                      {template.isPreset ? '内置预设' : '自定义'}
                    </Badge>
                    {template.derivedFrom && (
                      <Badge variant="outline" className="text-[10px] px-1.5 text-muted-foreground">
                        基于模板另存
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {template.description || '暂无描述'}
                </p>
              </CardHeader>
              <CardContent className="pb-3">
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span>{template.tiers.length} 个层级</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <TagIcon className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span>
                      {template.identityTags.length + template.attributeTags.length} 个标签
                    </span>
                  </div>
                </div>
                {/* 层级颜色预览：显示层级名称首字（value 只是字母标识，行业模板的 label 才是语义） */}
                <div className="flex items-center gap-1.5 mt-3">
                  {template.tiers.slice(0, 6).map((tier: TemplateTier) => (
                    <div
                      key={tier.value}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium text-white"
                      style={{ backgroundColor: tier.color }}
                      title={`${tier.label}${tier.description ? ` · ${tier.description}` : ''}`}
                    >
                      {(tier.label || tier.value).charAt(0)}
                    </div>
                  ))}
                </div>
                {isActive && (
                  <div className="flex items-center gap-1 mt-3 text-xs text-primary">
                    <Check className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span>当前使用</span>
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex items-center gap-2 pt-0">
                <Button
                  variant={isActive ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={() => handleApply(template)}
                >
                  {isActive ? (
                    <>
                      <Check className="w-3.5 h-3.5" strokeWidth={1.5} />
                      使用中
                    </>
                  ) : (
                    '应用'
                  )}
                </Button>
                {/* 预览：查看模板完整内容（所有模板可用） */}
                <Button
                  variant="outline"
                  size="sm"
                  title="预览模板内容"
                  onClick={() => setPreviewTemplate(template)}
                >
                  <Eye className="w-3.5 h-3.5" strokeWidth={1.5} />
                </Button>
                {/* 另存为新方案：预设或自定义均可复制后随意修改，不影响原模板 */}
                <Button
                  variant="outline"
                  size="sm"
                  title="另存为新方案"
                  onClick={() => handleDuplicate(template)}
                >
                  <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />
                </Button>
                {!template.isPreset && (
                  <>
                    {template.baseSnapshot && (
                      <Button
                        variant="outline"
                        size="sm"
                        title="重置为初始内容（另存那一刻的内容）"
                        onClick={() => handleReset(template)}
                      >
                        <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.5} />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenEdit(template)}
                    >
                      <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="text-destructive">
                          <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>确认删除模板</AlertDialogTitle>
                          <AlertDialogDescription>
                            确定要删除模板&quot;{template.name}&quot;吗？此操作无法撤销。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                            onClick={() => handleDelete(template)}
                          >
                            确认删除
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {templates.length === 0 && !loading && (
        <div className="text-center py-12 text-sm text-muted-foreground">
          暂无模板，点击右上角创建第一个模板
        </div>
      )}

      {/* 新建/编辑模板弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? '编辑模板' : '新建模板'}</DialogTitle>
            <DialogDescription>
              自定义人脉分层与标签体系
            </DialogDescription>
          </DialogHeader>

          {/* 基本信息 */}
          <div className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">模板名称 *</Label>
              <Input
                id="tpl-name"
                value={formData.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="请输入模板名称"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-desc">模板描述</Label>
              <Input
                id="tpl-desc"
                value={formData.description}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="简要描述这个模板的用途"
              />
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="pt-4">
            <TabsList>
              <TabsTrigger value="tiers">层级定义</TabsTrigger>
              <TabsTrigger value="tags">标签设置</TabsTrigger>
              <TabsTrigger value="format">备注名格式</TabsTrigger>
            </TabsList>

            {/* 层级定义 Tab */}
            <TabsContent value="tiers" className="pt-3">
              <div className="space-y-2">
                {formData.tiers.map((tier: TemplateTier, index: number) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 p-3 border border-border rounded-md bg-background"
                  >
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        className="p-0.5 hover:bg-muted rounded"
                        onClick={() => moveTier(index, -1)}
                        disabled={index === 0}
                      >
                        <ChevronUp className="w-3 h-3 text-muted-foreground" />
                      </button>
                      <button
                        type="button"
                        className="p-0.5 hover:bg-muted rounded"
                        onClick={() => moveTier(index, 1)}
                        disabled={index === formData.tiers.length - 1}
                      >
                        <ChevronDown className="w-3 h-3 text-muted-foreground" />
                      </button>
                    </div>
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium text-white flex-shrink-0"
                      style={{ backgroundColor: tier.color }}
                    >
                      {tier.value}
                    </div>
                    <Input
                      value={tier.value}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        updateTier(index, { value: e.target.value })
                      }
                      className="h-8 text-xs w-16"
                      placeholder="标识"
                    />
                    <Input
                      value={tier.label}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        updateTier(index, { label: e.target.value })
                      }
                      className="h-8 text-xs flex-1"
                      placeholder="层级名称"
                    />
                    <Input
                      value={tier.color}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        updateTier(index, { color: e.target.value })
                      }
                      className="h-8 text-xs w-24 font-mono"
                      placeholder="#xxx"
                    />
                    <button
                      type="button"
                      className="p-1 hover:bg-destructive/10 rounded"
                      onClick={() => removeTier(index)}
                    >
                      <X className="w-3.5 h-3.5 text-destructive" strokeWidth={1.5} />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full border-dashed"
                onClick={addTier}
              >
                <Plus className="w-4 h-4" strokeWidth={1.5} />
                添加层级
              </Button>
            </TabsContent>

            {/* 标签设置 Tab */}
            <TabsContent value="tags" className="pt-3">
              <div className="space-y-4">
                {/* 身份标签 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>身份标签</Label>
                    <span className="text-xs text-muted-foreground">
                      {formData.identityTags.length} 个
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {formData.identityTags.map((tag: TemplateTag, index: number) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 px-2 py-1.5 border border-border rounded-md bg-background"
                      >
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        <Input
                          value={tag.name}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            updateTag('identity', index, { name: e.target.value })
                          }
                          className="h-7 text-xs flex-1 border-none bg-transparent"
                          placeholder="标签名称"
                        />
                        <Input
                          value={tag.color || ''}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            updateTag('identity', index, { color: e.target.value })
                          }
                          className="h-7 text-xs w-20 font-mono"
                          placeholder="#xxx"
                        />
                        <button
                          type="button"
                          className="p-1 hover:bg-destructive/10 rounded"
                          onClick={() => removeTag('identity', index)}
                        >
                          <X className="w-3.5 h-3.5 text-destructive" strokeWidth={1.5} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 w-full border-dashed"
                    onClick={() => addTag('identity')}
                  >
                    <Plus className="w-3.5 h-3.5" strokeWidth={1.5} />
                    添加身份标签
                  </Button>
                </div>

                {/* 属性标签 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>属性标签</Label>
                    <span className="text-xs text-muted-foreground">
                      {formData.attributeTags.length} 个
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {formData.attributeTags.map((tag: TemplateTag, index: number) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 px-2 py-1.5 border border-border rounded-md bg-background"
                      >
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        <Input
                          value={tag.name}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            updateTag('attribute', index, { name: e.target.value })
                          }
                          className="h-7 text-xs flex-1 border-none bg-transparent"
                          placeholder="标签名称"
                        />
                        <Input
                          value={tag.color || ''}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            updateTag('attribute', index, { color: e.target.value })
                          }
                          className="h-7 text-xs w-20 font-mono"
                          placeholder="#xxx"
                        />
                        <button
                          type="button"
                          className="p-1 hover:bg-destructive/10 rounded"
                          onClick={() => removeTag('attribute', index)}
                        >
                          <X className="w-3.5 h-3.5 text-destructive" strokeWidth={1.5} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 w-full border-dashed"
                    onClick={() => addTag('attribute')}
                  >
                    <Plus className="w-3.5 h-3.5" strokeWidth={1.5} />
                    添加属性标签
                  </Button>
                </div>
              </div>
            </TabsContent>

            {/* 备注名格式 Tab */}
            <TabsContent value="format" className="pt-3">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>格式描述</Label>
                  <Input
                    value={formData.nicknameFormat.description}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      updateNickname({ description: e.target.value })
                    }
                    placeholder="备注名格式说明"
                  />
                </div>

                <div className="flex items-center justify-between p-3 border border-border rounded-md">
                  <div>
                    <div className="text-sm font-medium">层级前缀</div>
                    <div className="text-xs text-muted-foreground">
                      在备注名前添加层级标识
                    </div>
                  </div>
                  <Switch
                    checked={formData.nicknameFormat.useTierPrefix}
                    onCheckedChange={(checked: boolean) => {
                      updateNickname({ useTierPrefix: checked });
                      setTimeout(refreshExamples, 0);
                    }}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>层级分隔符</Label>
                  <Input
                    value={formData.nicknameFormat.tierSeparator}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      updateNickname({ tierSeparator: e.target.value });
                      setTimeout(refreshExamples, 0);
                    }}
                    className="w-24"
                    placeholder="·"
                  />
                </div>

                <div className="flex items-center justify-between p-3 border border-border rounded-md">
                  <div>
                    <div className="text-sm font-medium">关键信息括号</div>
                    <div className="text-xs text-muted-foreground">
                      用【】包裹关键属性标签
                    </div>
                  </div>
                  <Switch
                    checked={formData.nicknameFormat.useKeyInfoBrackets}
                    onCheckedChange={(checked: boolean) => {
                      updateNickname({ useKeyInfoBrackets: checked });
                      setTimeout(refreshExamples, 0);
                    }}
                  />
                </div>

                {/* 非客户前缀 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>非客户前缀</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={addNonClientPrefix}
                    >
                      <Plus className="w-3 h-3" strokeWidth={1.5} />
                      添加
                    </Button>
                  </div>
                  <div className="space-y-1.5">
                    {formData.nicknameFormat.nonClientPrefixes.map(
                      (item: { prefix: string; label: string }, index: number) => (
                        <div
                          key={index}
                          className="flex items-center gap-2 px-2 py-1.5 border border-border rounded-md bg-background"
                        >
                          <Input
                            value={item.prefix}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              updateNonClientPrefix(index, { prefix: e.target.value });
                              setTimeout(refreshExamples, 0);
                            }}
                            className="h-7 text-xs w-20"
                            placeholder="前缀"
                          />
                          <Input
                            value={item.label}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              updateNonClientPrefix(index, { label: e.target.value })
                            }
                            className="h-7 text-xs flex-1"
                            placeholder="说明"
                          />
                          <button
                            type="button"
                            className="p-1 hover:bg-destructive/10 rounded"
                            onClick={() => removeNonClientPrefix(index)}
                          >
                            <X className="w-3.5 h-3.5 text-destructive" strokeWidth={1.5} />
                          </button>
                        </div>
                      ),
                    )}
                  </div>
                </div>

                {/* 关系后缀 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>关系后缀</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={addRelationSuffix}
                    >
                      <Plus className="w-3 h-3" strokeWidth={1.5} />
                      添加
                    </Button>
                  </div>
                  <div className="space-y-1.5">
                    {formData.nicknameFormat.relationSuffixes.map(
                      (item: { suffix: string; label: string }, index: number) => (
                        <div
                          key={index}
                          className="flex items-center gap-2 px-2 py-1.5 border border-border rounded-md bg-background"
                        >
                          <Input
                            value={item.suffix}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              updateRelationSuffix(index, { suffix: e.target.value });
                              setTimeout(refreshExamples, 0);
                            }}
                            className="h-7 text-xs w-20"
                            placeholder="后缀"
                          />
                          <Input
                            value={item.label}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              updateRelationSuffix(index, { label: e.target.value })
                            }
                            className="h-7 text-xs flex-1"
                            placeholder="说明"
                          />
                          <button
                            type="button"
                            className="p-1 hover:bg-destructive/10 rounded"
                            onClick={() => removeRelationSuffix(index)}
                          >
                            <X className="w-3.5 h-3.5 text-destructive" strokeWidth={1.5} />
                          </button>
                        </div>
                      ),
                    )}
                  </div>
                </div>

                {/* 示例 */}
                <div>
                  <Label>格式示例</Label>
                  <div className="mt-2 space-y-1">
                    {formData.nicknameFormat.examples.map(
                      (ex: string, index: number) => (
                        <div
                          key={index}
                          className="text-sm text-foreground/80 font-mono px-3 py-1.5 bg-muted/50 rounded-md"
                        >
                          {ex}
                        </div>
                      ),
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSubmit}>
              {editingTemplate ? '保存修改' : '创建模板'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 模板预览弹窗 */}
      <Dialog open={!!previewTemplate} onOpenChange={(open: boolean) => !open && setPreviewTemplate(null)}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewTemplate?.name}
              {previewTemplate?.isPreset ? (
                <Badge variant="secondary">内置预设</Badge>
              ) : (
                <Badge variant="outline">自定义</Badge>
              )}
            </DialogTitle>
            <DialogDescription>{previewTemplate?.description || '暂无描述'}</DialogDescription>
          </DialogHeader>

          {previewTemplate && (
            <div className="space-y-4 pt-2">
              {/* 分层 */}
              <div>
                <Label className="text-sm font-medium">分层（{previewTemplate.tiers.length}）</Label>
                <div className="mt-2 space-y-1.5">
                  {previewTemplate.tiers.map((tier: TemplateTier) => (
                    <div key={tier.value} className="flex items-start gap-2 text-sm">
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium text-white flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: tier.color }}
                      >
                        {(tier.label || tier.value).charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <span className="font-medium">{tier.label}</span>
                        {tier.description && (
                          <span className="text-muted-foreground"> · {tier.description}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 标签 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm font-medium">
                    身份标签（{previewTemplate.identityTags.length}）
                  </Label>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {previewTemplate.identityTags.length === 0 && (
                      <span className="text-xs text-muted-foreground">无</span>
                    )}
                    {previewTemplate.identityTags.map((tag: TemplateTag) => (
                      <Badge key={tag.name} variant="outline" className="gap-1">
                        <span
                          className="w-2 h-2 rounded-full inline-block"
                          style={{ backgroundColor: tag.color }}
                        />
                        {tag.name}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium">
                    属性标签（{previewTemplate.attributeTags.length}）
                  </Label>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {previewTemplate.attributeTags.length === 0 && (
                      <span className="text-xs text-muted-foreground">无</span>
                    )}
                    {previewTemplate.attributeTags.map((tag: TemplateTag) => (
                      <Badge key={tag.name} variant="outline" className="gap-1">
                        <span
                          className="w-2 h-2 rounded-full inline-block"
                          style={{ backgroundColor: tag.color }}
                        />
                        {tag.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              {/* 业务字段 */}
              {previewTemplate.fields.length > 0 && (
                <div>
                  <Label className="text-sm font-medium">
                    业务字段（{previewTemplate.fields.length}）
                  </Label>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {previewTemplate.fields.map((field: TemplateField) => (
                      <Badge key={field.key} variant="secondary" className="font-normal">
                        {field.label}
                        <span className="text-[10px] text-muted-foreground ml-0.5">
                          {field.type === 'multiselect' ? '多选' : field.type}
                        </span>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* 备注名格式 */}
              <div>
                <Label className="text-sm font-medium">备注名格式</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  {previewTemplate.nicknameFormat.description}
                </p>
                <div className="mt-2 space-y-1">
                  {previewTemplate.nicknameFormat.examples.map((ex: string, index: number) => (
                    <div
                      key={index}
                      className="text-sm text-foreground/80 font-mono px-3 py-1.5 bg-muted/50 rounded-md"
                    >
                      {ex}
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-xs text-muted-foreground border-t pt-3">
                想基于这套方案做调整？点卡片上的
                <Copy className="w-3 h-3 inline mx-0.5" strokeWidth={1.5} />
                「另存为新方案」，复制一份随意修改，原模板不受影响。
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TemplatesPage;
