import React, { useState, useEffect } from 'react';
import {
  Pencil,
  Trash2,
  Plus,
  Tag as TagIcon,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';

import { Button } from '@client/src/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@client/src/components/ui/card';
import { Input } from '@client/src/components/ui/input';
import { Label } from '@client/src/components/ui/label';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';

import {
  getTags,
  createTag,
  updateTag,
  deleteTag,
} from '@client/src/api/tags';
import { getActiveTemplate, alignTagsToTemplate } from '@client/src/api/templates';
import { getContacts } from '@client/src/api/contacts';
import type { Tag, TagCategory, CreateTagRequest, Contact, ContactTemplate, AlignTagsResponse } from '@shared/api.interface';

const CATEGORY_LABELS: Record<TagCategory, string> = {
  identity: '身份类标签',
  attribute: '属性类标签',
  custom: '自定义',
};

const CATEGORY_DESC: Record<TagCategory, string> = {
  identity: '买房客户、卖房业主、租客、同事、同行、朋友、家人、渠道',
  attribute: '小区、来源、托管、节点客户等业务属性',
  custom: '用户自定义分类标签',
};

const PRESET_COLORS: string[] = [
  '#dc2626',
  '#d97706',
  '#16a34a',
  '#2563eb',
  '#db2777',
  '#64748b',
  '#0891b2',
];

const CATEGORIES: TagCategory[] = ['identity', 'attribute', 'custom'];

const TagsPage: React.FC = () => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [formData, setFormData] = useState<CreateTagRequest>({
    name: '',
    category: 'identity',
    color: '#dc2626',
    sortOrder: 0,
  });
  const [activeTemplate, setActiveTemplate] = useState<ContactTemplate | null>(null);
  const [aligning, setAligning] = useState<boolean>(false);
  const [alignConfirmOpen, setAlignConfirmOpen] = useState<boolean>(false);
  const [alignReport, setAlignReport] = useState<AlignTagsResponse | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [tagsData, contactsRes, activeTpl] = await Promise.all([
        getTags(),
        getContacts({ pageSize: 1000, page: 1 }),
        getActiveTemplate().catch(() => null),
      ]);
      setTags(tagsData);
      setContacts(contactsRes.items || []);
      setActiveTemplate(activeTpl);
    } catch (error) {
      logger.error('加载数据失败', error);
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
  }, []);

  const getTagContactCount = (tagId: string): number => {
    return contacts.filter((c: Contact) =>
      (c.tags || []).some((t) => t.id === tagId)
    ).length;
  };

  const groupedTags = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = tags
      .filter((t: Tag) => t.category === cat)
      .sort((a: Tag, b: Tag) => a.sortOrder - b.sortOrder);
    return acc;
  }, {} as Record<TagCategory, Tag[]>);

  const handleOpenAdd = (category: TagCategory = 'identity') => {
    setEditingTag(null);
    setFormData({
      name: '',
      category,
      color: PRESET_COLORS[0],
      sortOrder: groupedTags[category].length,
    });
    setDialogOpen(true);
  };

  const handleOpenEdit = (tag: Tag) => {
    setEditingTag(tag);
    setFormData({
      name: tag.name,
      category: tag.category,
      color: tag.color,
      sortOrder: tag.sortOrder,
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast.error('请输入标签名称');
      return;
    }
    try {
      if (editingTag) {
        await updateTag(editingTag.id, formData);
        toast.success('标签已更新');
      } else {
        await createTag(formData);
        toast.success('标签已创建');
      }
      setDialogOpen(false);
      loadData();
    } catch (error) {
      logger.error('保存标签失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`保存失败：${msg}`);
    }
  };

  const handleDelete = async (tag: Tag) => {
    try {
      await deleteTag(tag.id);
      toast.success(`已删除标签"${tag.name}"`);
      loadData();
    } catch (error) {
      logger.error('删除标签失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`删除失败：${msg}`);
    }
  };

  const handleAlign = async () => {
    setAligning(true);
    try {
      const report = await alignTagsToTemplate();
      setAlignConfirmOpen(false);
      setAlignReport(report);
      await loadData();
    } catch (error) {
      logger.error('对齐标签失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`对齐失败：${msg}`);
    } finally {
      setAligning(false);
    }
  };

  if (loading && tags.length === 0) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">标签管理</h2>
            <p className="text-sm text-slate-600 mt-1">按分组组织人脉圈层</p>
          </div>
        </div>
        <div className="text-sm text-slate-400">加载中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* 页面标题 + 对齐模板 + 新增按钮 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">标签管理</h2>
          <p className="text-sm text-slate-600 mt-1">
            {activeTemplate
              ? `当前方案「${activeTemplate.name}」· ${activeTemplate.identityTags?.length ?? 0} 身份 + ${activeTemplate.attributeTags?.length ?? 0} 属性标签`
              : '按分组管理联系人标签'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTemplate && (
            <Button
              variant="outline"
              onClick={() => setAlignConfirmOpen(true)}
              disabled={aligning}
            >
              <TagIcon className="w-4 h-4" />
              {aligning ? '对齐中...' : '对齐模板'}
            </Button>
          )}
          <Button
            className="bg-amber-600 hover:bg-amber-700 text-white border-amber-600"
            onClick={() => handleOpenAdd('identity')}
          >
            <Plus className="w-4 h-4" />
            新增标签
          </Button>
        </div>
      </div>

      {/* 分类卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {CATEGORIES.map((cat) => (
          <Card
            key={cat}
            className="border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <TagIcon className="w-4 h-4 text-slate-500" />
                  {CATEGORY_LABELS[cat]}
                </CardTitle>
                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                  {groupedTags[cat].length} 个标签
                </span>
              </div>
              <p className="text-xs text-slate-400">{CATEGORY_DESC[cat]}</p>
            </CardHeader>
            <CardContent>
              {groupedTags[cat].length === 0 ? (
                <div className="text-center py-6 text-sm text-slate-400">
                  该分类下暂无标签
                </div>
              ) : (
                <div className="space-y-1 md:space-y-1 space-y-2">
                  {groupedTags[cat].map((tag: Tag) => {
                    const count = getTagContactCount(tag.id);
                    return (
                      <div
                        key={tag.id}
                          className="group flex items-center gap-3 px-3 md:px-3 py-3 md:py-2 rounded-lg hover:bg-slate-50 transition-colors"
                      >
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="flex-1 text-sm text-slate-700 truncate">
                          {tag.name}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-slate-400 flex-shrink-0">
                          <Users className="w-3 h-3" />
                          {count}
                        </span>
                        <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button
                            className="h-9 w-9 md:p-1.5 md:h-8 md:w-8 p-2 hover:bg-slate-200 rounded-md transition-colors flex items-center justify-center"
                            onClick={() => handleOpenEdit(tag)}
                            title="编辑"
                          >
                            <Pencil className="w-4 h-4 md:w-3.5 md:h-3.5 text-slate-500" />
                          </button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <button
                                className="h-9 w-9 md:p-1.5 md:h-8 md:w-8 p-2 hover:bg-red-50 rounded-md transition-colors flex items-center justify-center"
                                title="删除"
                              >
                                <Trash2 className="w-4 h-4 md:w-3.5 md:h-3.5 text-red-500" />
                              </button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>确认删除标签</AlertDialogTitle>
                                <AlertDialogDescription>
                                  确定要删除标签&quot;{tag.name}&quot;吗？
                                  此操作会移除所有联系人的该标签关联，且无法撤销。
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>取消</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-red-600 hover:bg-red-700 text-white"
                                  onClick={() => handleDelete(tag)}
                                >
                                  确认删除
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full border-dashed"
                onClick={() => handleOpenAdd(cat)}
              >
                <Plus className="w-4 h-4" />
                添加标签
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 新增/编辑标签弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTag ? '编辑标签' : '新增标签'}
            </DialogTitle>
            <DialogDescription>
              设置标签名称、分类和颜色
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="tag-name">标签名称 *</Label>
              <Input
                id="tag-name"
                value={formData.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="请输入标签名称"
              />
            </div>

            <div className="space-y-2">
              <Label>所属分类</Label>
              <Select
                value={formData.category}
                onValueChange={(val: string) => {
                  const cat = val as TagCategory;
                  setFormData({ ...formData, category: cat });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {CATEGORY_LABELS[cat]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>标签颜色</Label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((color: string) => (
                  <button
                    key={color}
                    type="button"
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      formData.color === color
                        ? 'border-slate-800 scale-110'
                        : 'border-transparent hover:border-slate-300'
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setFormData({ ...formData, color })}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-slate-400">自定义：</span>
                <Input
                  type="text"
                  value={formData.color}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setFormData({ ...formData, color: e.target.value })
                  }
                  className="h-8 text-xs font-mono"
                  placeholder="#xxxxxx"
                />
                <div
                  className="w-8 h-8 rounded-full border border-slate-200 flex-shrink-0"
                  style={{ backgroundColor: formData.color }}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white border-amber-600"
              onClick={handleSubmit}
            >
              {editingTag ? '保存修改' : '创建标签'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 对齐模板确认弹窗 */}
      <AlertDialog open={alignConfirmOpen} onOpenChange={setAlignConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>对齐标签到「{activeTemplate?.name}」</AlertDialogTitle>
            <AlertDialogDescription>
              将把标签库与当前模板方案对齐：
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="text-sm text-slate-600 space-y-1.5 list-disc pl-5">
            <li>补齐模板定义但缺失的标签（{activeTemplate?.identityTags?.length ?? 0} 身份 + {activeTemplate?.attributeTags?.length ?? 0} 属性）</li>
            <li>同步产生的同名标签自动转正</li>
            <li>模板之外的身份/属性标签移入「同步隔离区」，不会删除，可随时找回</li>
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={aligning}
              onClick={(e: React.MouseEvent) => {
                e.preventDefault();
                handleAlign();
              }}
            >
              {aligning ? '对齐中...' : '立即对齐'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 对齐结果弹窗 */}
      <Dialog open={!!alignReport} onOpenChange={(open: boolean) => !open && setAlignReport(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>对齐完成</DialogTitle>
            <DialogDescription>
              标签库已与「{alignReport?.templateName}」对齐
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">新建标签</span>
              <span className="font-medium">
                {(alignReport?.createdIdentity.length ?? 0) + (alignReport?.createdAttribute.length ?? 0)} 个
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">同步标签转正</span>
              <span className="font-medium">{alignReport?.promotedSync.length ?? 0} 个</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">移入隔离区</span>
              <span className="font-medium">{alignReport?.demoted.length ?? 0} 个</span>
            </div>
            {(alignReport?.demoted.length ?? 0) > 0 && (
              <div className="text-xs text-slate-500 leading-relaxed pt-1 border-t border-slate-100">
                隔离名单：{alignReport?.demoted.join('、')}
              </div>
            )}
            <div className="text-xs text-slate-400 pt-1">
              当前：身份 {alignReport?.totals.identity ?? 0} · 属性 {alignReport?.totals.attribute ?? 0} · 同步隔离 {alignReport?.totals.sync ?? 0}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setAlignReport(null)}>好的</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TagsPage;
