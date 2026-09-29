/**
 * 朋友圈分组（v2 重构）
 * 1) 圈层自动跟随当前使用的模板：分层圈（模板 tiers）+ 身份标签圈（模板 identityTags）；
 *    未应用模板时回退出厂 S-V 分层
 * 2) 自定义分组：按标签多选匹配（命中任一即入组），存服务端按用户隔离（moments_config）
 * 3) 本周内容日历：真实周一~周日日期、今天高亮，可编辑保存（默认给 4 天专业建议）
 * 4) 每个圈层可「查看列表」，展示命中联系人明细
 */
import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  Users,
  CalendarDays,
  ChevronRight,
  Layers,
  Tag as TagIcon,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Sparkles,
  Phone,
  X,
} from 'lucide-react';

import { Card, CardContent } from '@client/src/components/ui/card';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { Input } from '@client/src/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';

import { getContacts } from '@client/src/api/contacts';
import { getActiveTemplate } from '@client/src/api/templates';
import { getMomentsConfig, updateMomentsConfig } from '@client/src/api/moments';
import type {
  Contact,
  ContactTemplate,
  MomentsCalendarItem,
  MomentsConfigResponse,
  MomentsCustomGroup,
  TemplateTier,
} from '@shared/api.interface';

const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 未应用模板时的出厂分层回退（与后端 FACTORY_TIERS 保持一致） */
const FACTORY_TIERS_FALLBACK: TemplateTier[] = [
  { value: 'S', label: 'S 级', description: '核心关系', color: '#0f172a', sortOrder: 0 },
  { value: 'A', label: 'A 级', description: '重要关系', color: '#1e293b', sortOrder: 1 },
  { value: 'B', label: 'B 级', description: '普通朋友', color: '#334155', sortOrder: 2 },
  { value: 'C', label: 'C 级', description: '认识的人', color: '#64748b', sortOrder: 3 },
  { value: 'D', label: 'D 级', description: '弱关系', color: '#94a3b8', sortOrder: 4 },
  { value: 'V', label: 'V 级', description: '已维护关系', color: '#059669', sortOrder: 5 },
];

/** 圈层统一模型：分层 / 身份标签 / 自定义分组 三种来源收敛成一种渲染 */
interface CircleGroup {
  key: string;
  kind: 'tier' | 'identity' | 'custom';
  name: string;
  description: string;
  color: string;
  tagNames: string[];
  tierValue?: string;
  customGroup?: MomentsCustomGroup;
}

const MomentsPage: React.FC = () => {
  const [template, setTemplate] = useState<ContactTemplate | null>(null);
  const [config, setConfig] = useState<MomentsConfigResponse | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  // 周历编辑态
  const [calEditing, setCalEditing] = useState(false);
  const [calDraft, setCalDraft] = useState<MomentsCalendarItem[]>([]);
  const [calSaving, setCalSaving] = useState(false);

  // 查看列表 / 分组编辑弹窗
  const [viewGroup, setViewGroup] = useState<CircleGroup | null>(null);
  const [editGroup, setEditGroup] = useState<MomentsCustomGroup | null>(null);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [tpl, cfg, contactRes] = await Promise.all([
          getActiveTemplate(),
          getMomentsConfig(),
          getContacts({ pageSize: 1000, page: 1 }),
        ]);
        setTemplate(tpl);
        setConfig(cfg);
        setContacts(contactRes.items || []);
      } catch (e) {
        toast.error('加载朋友圈配置失败');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  // 本周真实日期（周一起始）与今天
  const weekDates = useMemo(() => {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  }, []);
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  // 标签池：联系人已有标签 ∪ 模板身份标签（供自定义分组勾选）
  const tagPool = useMemo(() => {
    const set = new Set<string>((template?.identityTags || []).map(t => t.name));
    contacts.forEach(c => (c.tags || []).forEach(t => set.add(t.name)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [contacts, template]);

  // 三类圈层收敛
  const circles: CircleGroup[] = useMemo(() => {
    if (!config) return [];
    const tiers = template?.tiers?.length ? template.tiers : FACTORY_TIERS_FALLBACK;
    const list: CircleGroup[] = tiers.map(t => ({
      key: `tier:${t.value}`,
      kind: 'tier',
      name: `${t.label}${t.description ? ` · ${t.description}` : ''}`,
      description: '按分层自动分组，跟随当前模板',
      color: t.color,
      tagNames: [],
      tierValue: t.value,
    }));
    (template?.identityTags || []).forEach(t => {
      list.push({
        key: `identity:${t.name}`,
        kind: 'identity',
        name: t.name,
        description: '模板身份标签，按联系人标签匹配',
        color: t.color || '#64748b',
        tagNames: [t.name],
      });
    });
    (config.customGroups || []).forEach(g => {
      list.push({
        key: `custom:${g.id}`,
        kind: 'custom',
        name: g.name,
        description: g.description || '自定义分组',
        color: '#2563eb',
        tagNames: g.tagNames,
        customGroup: g,
      });
    });
    return list;
  }, [template, config]);

  const matchCircle = (c: CircleGroup, contact: Contact): boolean => {
    if (c.kind === 'tier') return contact.tier === c.tierValue;
    return (contact.tags || []).some(t => c.tagNames.includes(t.name));
  };

  const contactsOf = (c: CircleGroup): Contact[] => contacts.filter(ct => matchCircle(c, ct));

  // ===== 周历编辑 =====
  const startCalEdit = () => {
    const cur = config?.calendar || [];
    setCalDraft(
      DAY_NAMES.map((_, day) => {
        const found = cur.find(c => c.day === day);
        return { day, theme: found?.theme ?? '', content: found?.content ?? '' };
      }),
    );
    setCalEditing(true);
  };

  const saveCalendar = async () => {
    const cleaned = calDraft.filter(c => c.theme.trim() || c.content.trim());
    setCalSaving(true);
    try {
      const next = await updateMomentsConfig({ calendar: cleaned });
      setConfig(next);
      setCalEditing(false);
      toast.success('本周日历已保存');
    } catch {
      toast.error('保存失败');
    } finally {
      setCalSaving(false);
    }
  };

  // ===== 自定义分组 =====
  const saveGroup = async (group: MomentsCustomGroup) => {
    if (!config) return;
    const exists = config.customGroups.some(g => g.id === group.id);
    const next = exists
      ? config.customGroups.map(g => (g.id === group.id ? group : g))
      : [...config.customGroups, group];
    try {
      const res = await updateMomentsConfig({ customGroups: next });
      setConfig(res);
      setGroupDialogOpen(false);
      toast.success(exists ? '分组已更新' : `分组「${group.name}」已创建`);
    } catch {
      toast.error('保存分组失败');
    }
  };

  const removeGroup = async (g: MomentsCustomGroup) => {
    if (!config) return;
    try {
      const res = await updateMomentsConfig({
        customGroups: config.customGroups.filter(x => x.id !== g.id),
      });
      setConfig(res);
      toast.success(`分组「${g.name}」已删除（不影响联系人与标签）`);
    } catch {
      toast.error('删除失败');
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> 加载朋友圈配置…
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* 页头 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">朋友圈分组</h2>
          <p className="text-sm text-slate-600 mt-1">
            圈层自动跟随当前使用的模板，也可以按标签自定义分组
          </p>
        </div>
        {template ? (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1">
            <Sparkles className="w-3 h-3" />
            当前模板：{template.name}
          </Badge>
        ) : (
          <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">
            未应用模板 · 使用出厂分层（可在「模板」页应用）
          </Badge>
        )}
      </div>

      {/* 圈层 */}
      <div>
        <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Users className="w-5 h-5 text-slate-500" />
          朋友圈圈层
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {circles.map(c => {
            const count = contactsOf(c).length;
            return (
              <Card
                key={c.key}
                className="group border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer"
                onClick={() => setViewGroup(c)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: c.color }}
                    />
                    <span className="font-medium text-slate-900 truncate">
                      {c.kind === 'tier' && <Layers className="w-3.5 h-3.5 inline mr-1 text-slate-400" />}
                      {c.kind === 'identity' && <TagIcon className="w-3.5 h-3.5 inline mr-1 text-slate-400" />}
                      {c.name}
                    </span>
                    <span className="ml-auto text-sm font-semibold text-slate-700 shrink-0">{count}</span>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 shrink-0" />
                  </div>
                  <div className="mt-1.5 text-xs text-slate-400 truncate">{c.description}</div>
                  {c.kind === 'custom' && c.customGroup && c.customGroup.tagNames.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.customGroup.tagNames.slice(0, 4).map(n => (
                        <Badge key={n} variant="outline" className="text-[10px] px-1.5 py-0 bg-slate-50 text-slate-500 border-slate-200">
                          {n}
                        </Badge>
                      ))}
                      {c.customGroup.tagNames.length > 4 && (
                        <span className="text-[10px] text-slate-400">+{c.customGroup.tagNames.length - 4}</span>
                      )}
                    </div>
                  )}
                  {c.kind === 'custom' && c.customGroup && (
                    <div className="mt-2 flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-slate-500"
                        onClick={() => { setEditGroup(c.customGroup!); setGroupDialogOpen(true); }}
                      >
                        <Pencil className="w-3 h-3" /> 编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => void removeGroup(c.customGroup!)}
                      >
                        <Trash2 className="w-3 h-3" /> 删除
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {/* 新建分组 */}
          <button
            type="button"
            className="min-h-[96px] rounded-xl border-2 border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 transition-colors flex flex-col items-center justify-center gap-1 text-slate-400 hover:text-blue-600"
            onClick={() => { setEditGroup(null); setGroupDialogOpen(true); }}
          >
            <Plus className="w-5 h-5" />
            <span className="text-xs">按标签新建分组</span>
          </button>
        </div>
      </div>

      {/* 本周内容日历 */}
      <div>
        <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
          <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-slate-500" />
            本周内容日历
            <span className="text-xs font-normal text-slate-400">
              {format(weekDates[0], 'MM.dd')} — {format(weekDates[6], 'MM.dd')}
              {!config?.calendarIsDefault && ' · 已自定义'}
            </span>
          </h3>
          {!calEditing && (
            <Button size="sm" variant="outline" onClick={startCalEdit}>
              <Pencil className="w-3.5 h-3.5" /> 编辑日历
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {(calEditing ? calDraft : DAY_NAMES.map((_, day) => {
            const found = config?.calendar?.find(c => c.day === day);
            return { day, theme: found?.theme ?? '', content: found?.content ?? '' };
          })).map((item, idx) => {
            const date = weekDates[idx];
            const isToday = format(date, 'yyyy-MM-dd') === todayStr;
            const empty = !item.theme && !item.content;
            return (
              <Card
                key={item.day}
                className={`border shadow-sm transition-all duration-200 ${
                  isToday ? 'ring-2 ring-blue-500 border-blue-200' : 'border-slate-200'
                } ${empty && !calEditing ? 'bg-slate-50/60' : ''}`}
              >
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <span className={`text-sm font-semibold ${isToday ? 'text-blue-700' : 'text-slate-900'}`}>
                      {DAY_NAMES[idx]}
                    </span>
                    {isToday ? (
                      <Badge className="bg-blue-600 text-white border-0 text-[10px] px-1.5 py-0">今天</Badge>
                    ) : (
                      <span className="text-[10px] text-slate-400">{format(date, 'MM.dd')}</span>
                    )}
                  </div>
                  {calEditing ? (
                    <div className="space-y-1.5">
                      <Input
                        value={item.theme}
                        onChange={(e) =>
                          setCalDraft(prev => prev.map(c => (c.day === item.day ? { ...c, theme: e.target.value } : c)))
                        }
                        placeholder="主题"
                        className="h-7 text-xs"
                      />
                      <Input
                        value={item.content}
                        onChange={(e) =>
                          setCalDraft(prev => prev.map(c => (c.day === item.day ? { ...c, content: e.target.value } : c)))
                        }
                        placeholder="发什么（可留空休息）"
                        className="h-7 text-xs"
                      />
                    </div>
                  ) : empty ? (
                    <div className="text-xs text-slate-300 italic">休息 / 自由安排</div>
                  ) : (
                    <>
                      {item.theme && (
                        <Badge variant="outline" className="mb-1.5 bg-blue-50 text-blue-700 border-blue-200 text-[10px] px-1.5 py-0">
                          {item.theme}
                        </Badge>
                      )}
                      <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">{item.content}</p>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {calEditing && (
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={() => void saveCalendar()} disabled={calSaving}>
              {calSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              保存日历
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCalEditing(false)}>取消</Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-slate-500"
              onClick={() =>
                setCalDraft(
                  DAY_NAMES.map((_, day) => {
                    const d = config?.calendar?.find(c => c.day === day);
                    return { day, theme: d?.theme ?? '', content: d?.content ?? '' };
                  }),
                )
              }
            >
              还原修改
            </Button>
            <span className="text-xs text-slate-400">留空的日期即休息日，保存后按真实周历展示</span>
          </div>
        )}
      </div>

      {/* 查看圈层列表 */}
      <CircleListDialog group={viewGroup} contacts={viewGroup ? contactsOf(viewGroup) : []} onClose={() => setViewGroup(null)} />

      {/* 新建 / 编辑自定义分组 */}
      <GroupEditDialog
        open={groupDialogOpen}
        editing={editGroup}
        tagPool={tagPool}
        onClose={() => { setGroupDialogOpen(false); setEditGroup(null); }}
        onSave={(g) => void saveGroup(g)}
      />
    </div>
  );
};

/** 圈层联系人列表弹窗 */
const CircleListDialog: React.FC<{
  group: CircleGroup | null;
  contacts: Contact[];
  onClose: () => void;
}> = ({ group, contacts, onClose }) => (
  <Dialog open={!!group} onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="max-w-lg">
      {group && (
        <>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: group.color }} />
              {group.name}
              <span className="text-sm font-normal text-slate-400">{contacts.length} 人</span>
            </DialogTitle>
            <DialogDescription>
              {group.kind === 'tier'
                ? '按联系人分层匹配（跟随当前模板）'
                : group.kind === 'identity'
                  ? '按模板身份标签匹配'
                  : `命中标签：${group.tagNames.join('、') || '（未选标签）'}`}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-100">
            {contacts.length === 0 && (
              <div className="p-6 text-center text-sm text-slate-400">该圈层暂无联系人</div>
            )}
            {contacts.map(c => (
              <div key={c.id} className="px-3 py-2 flex items-center gap-2 min-w-0">
                <span className="text-xs font-mono text-white rounded px-1 py-0.5 shrink-0" style={{ backgroundColor: group.color }}>
                  {c.tier || '-'}
                </span>
                <span className="text-sm font-medium text-slate-800 truncate">{c.name}</span>
                {c.phone && (
                  <span className="text-xs text-slate-400 flex items-center gap-0.5 shrink-0">
                    <Phone className="w-3 h-3" />
                    {c.phone}
                  </span>
                )}
                <span className="ml-auto flex gap-1 overflow-hidden shrink-0">
                  {(c.tags || []).slice(0, 3).map(t => (
                    <Badge key={t.id} variant="outline" className="text-[10px] px-1 py-0 bg-slate-50 text-slate-500 border-slate-200 max-w-[72px] truncate">
                      {t.name}
                    </Badge>
                  ))}
                </span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>关闭</Button>
          </DialogFooter>
        </>
      )}
    </DialogContent>
  </Dialog>
);

/** 新建 / 编辑自定义分组弹窗 */
const GroupEditDialog: React.FC<{
  open: boolean;
  editing: MomentsCustomGroup | null;
  tagPool: string[];
  onClose: () => void;
  onSave: (group: MomentsCustomGroup) => void;
}> = ({ open, editing, tagPool, onClose, onSave }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  // 打开时初始化（新建空白 / 编辑回填）
  useEffect(() => {
    if (open) {
      setName(editing?.name ?? '');
      setDescription(editing?.description ?? '');
      setPicked(editing?.tagNames ?? []);
    }
  }, [open, editing]);

  const toggleTag = (n: string) =>
    setPicked(prev => (prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n]));

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('请填写分组名称');
      return;
    }
    if (picked.length === 0) {
      toast.error('请至少选择 1 个标签');
      return;
    }
    onSave({
      id: editing?.id ?? `cg_${Date.now()}`,
      name: name.trim(),
      description: description.trim() || undefined,
      tagNames: picked,
      sortOrder: editing?.sortOrder ?? 0,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? '编辑分组' : '新建自定义分组'}</DialogTitle>
          <DialogDescription>联系人命中任一所选标签即进入该分组；只保存分组定义，不改动联系人数据</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="分组名称（如：重点跟进客户）" />
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="备注说明（可选）" />
          <div>
            <div className="text-xs text-slate-500 mb-1.5">选择标签（可多选）</div>
            {tagPool.length === 0 ? (
              <div className="text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg p-3 text-center">
                暂无可用标签，先在联系人或模板中创建标签
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto border border-slate-100 rounded-lg p-2">
                {tagPool.map(n => {
                  const on = picked.includes(n);
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => toggleTag(n)}
                      className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors ${
                        on
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                      }`}
                    >
                      {n}
                      {on && <X className="w-3 h-3" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSave}>{editing ? '保存修改' : '创建分组'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MomentsPage;
