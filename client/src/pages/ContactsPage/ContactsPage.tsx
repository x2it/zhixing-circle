import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import {
  Search,
  LayoutList,
  Grid3X3,
  Plus,
  Filter,
  ChevronDown,
  X,
  Archive,
  Layers,
  ArrowUp,
  ArrowDown,
  Smartphone,
} from 'lucide-react';
import type { ContactsSortField } from './ContactListView';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Badge } from '@client/src/components/ui/badge';
import ContactCardView from './ContactCardView';
import ContactListView from './ContactListView';
import ContactDetailDrawer from './ContactDetailDrawer';
import ContactFormDialog from './ContactFormDialog';
import PaginationSimple from './PaginationSimple';
import ScrollFab from '@client/src/components/ScrollFab';
import * as contactsApi from '@client/src/api/contacts';
import * as tagsApi from '@client/src/api/tags';
import * as followupsApi from '@client/src/api/followups';
import * as batchesApi from '@client/src/api/batches';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import type {
  Contact,
  ContactTier,
  Tag,
  Followup,
  FollowupType,
  CreateContactRequest,
  UpdateContactRequest,
  ContactListQuery,
  ImportBatch,
} from '@shared/api.interface';
import { tierOptions } from '@client/src/utils/tier-utils';
import { showConfirm } from '@lark-apaas/client-toolkit';

const ContactsPage: React.FC = () => {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = location.state as { defaultTier?: ContactTier; openCreate?: boolean; editContactId?: string } | null;

  // Data
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState<ContactTier | ''>('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [archived, setArchived] = useState<boolean | 'all'>(false);
  const [batchId, setBatchId] = useState<string>('');
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [view, setView] = useState<'card' | 'list'>('card');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  // URL 驱动的筛选/排序状态（刷新/返回不丢失）
  const sortBy = (searchParams.get('sortBy') as ContactsSortField) || null;
  const sortOrder = searchParams.get('sortOrder') === 'desc' ? 'desc' : 'asc';
  const followupStatus =
    (searchParams.get('followupStatus') as ContactListQuery['followupStatus']) || '';
  const phoneStatus = searchParams.get('phoneStatus') === 'without' ? 'without' : '';

  const patchSearchParams = useCallback(
    (patch: Record<string, string | null>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(patch).forEach(([k, v]) => {
          if (v) next.set(k, v);
          else next.delete(k);
        });
        if (!('page' in patch)) next.delete('page');
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  /** 9999 = 「全部」，服务端按 MAX_PAGE_SIZE(5000) 封顶并回显实际值 */
  const pageSizeOptions = [20, 50, 100, 200, 500, 9999];

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  /** 跨页全选：作用于当前筛选命中的全部联系人，而不只是本页 */
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  /** 批量打标签选中的标签 */
  const [batchTagId, setBatchTagId] = useState('');

  // Dialog / Drawer state
  const [formOpen, setFormOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [loadingFollowups, setLoadingFollowups] = useState(false);
  const [addingFollowup, setAddingFollowup] = useState(false);
  const [mergeLogs, setMergeLogs] = useState<import('@shared/api.interface').MergeLog[]>([]);
  const [loadingMergeLogs, setLoadingMergeLogs] = useState(false);

  // Load tags and batches once
  useEffect(() => {
    void loadTags();
    void loadBatches();
  }, []);

  // Load contacts when filters change
  useEffect(() => {
    void loadContacts();
    setSelectedIds([]);
  }, [search, tier, selectedTagIds, archived, batchId, page, pageSize, sortBy, sortOrder, followupStatus, phoneStatus]);

  // Handle initial state from navigation
  useEffect(() => {
    if (state?.openCreate && !formOpen) {
      setFormOpen(true);
      setEditingContact(null);
    }
    if (state?.editContactId) {
      const found = contacts.find((c: Contact) => c.id === state.editContactId);
      if (found) {
        setSelectedContact(found);
        setDrawerOpen(true);
      }
    }
  }, [state, formOpen, contacts]);

  const loadTags = async (): Promise<void> => {
    try {
      const data = await tagsApi.getTags();
      setAllTags(data);
    } catch (error) {
      logger.error('获取标签失败', error);
    }
  };

  const loadBatches = async (): Promise<void> => {
    try {
      const data = await batchesApi.getBatches();
      setBatches(data);
    } catch (error) {
      logger.error('获取批次列表失败', error);
    }
  };

  const loadContacts = async (): Promise<void> => {
    try {
      setLoading(true);
      const params: ContactListQuery = {
        page,
        pageSize,
      };
      if (search.trim()) params.search = search.trim();
      if (tier) params.tier = tier;
      if (selectedTagIds.length > 0) params.tagIds = selectedTagIds;
      if (archived !== 'all') params.archived = archived;
      if (batchId) params.batchId = batchId;
      if (followupStatus) params.followupStatus = followupStatus;
      if (phoneStatus) params.phoneStatus = phoneStatus;
      if (sortBy) {
        params.sortBy = sortBy;
        params.sortOrder = sortOrder;
      }
      const data = await contactsApi.getContacts(params);
      setContacts(data.items);
      setTotal(data.total);
    } catch (error) {
      logger.error('获取联系人列表失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`获取联系人列表失败：${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    setSearch(e.target.value);
    setPage(1);
  }, []);

  const handleTierClick = useCallback((t: ContactTier | ''): void => {
    setTier(t);
    setPage(1);
  }, []);

  const toggleTag = useCallback((tagId: string): void => {
    setSelectedTagIds((prev: string[]) =>
      prev.includes(tagId) ? prev.filter((id: string) => id !== tagId) : [...prev, tagId]
    );
    setPage(1);
  }, []);

  const clearTagFilter = useCallback((): void => {
    setSelectedTagIds([]);
    setPage(1);
  }, []);

  const handleArchiveChange = useCallback((val: boolean | 'all'): void => {
    setArchived(val);
    setPage(1);
  }, []);

  const handleBatchChange = useCallback((val: string): void => {
    setBatchId(val);
    setPage(1);
  }, []);

  const handlePageSizeChange = useCallback((val: string): void => {
    setPageSize(Number(val));
    setPage(1);
  }, []);

  const handleSort = useCallback(
    (field: ContactsSortField): void => {
      if (sortBy !== field) {
        patchSearchParams({ sortBy: field, sortOrder: 'asc', page: null });
      } else if (sortOrder === 'asc') {
        patchSearchParams({ sortBy: field, sortOrder: 'desc', page: null });
      } else {
        patchSearchParams({ sortBy: null, sortOrder: null, page: null });
      }
    },
    [sortBy, sortOrder, patchSearchParams],
  );

  const handleFollowupStatusChange = useCallback(
    (val: ContactListQuery['followupStatus'] | ''): void => {
      patchSearchParams({ followupStatus: val || null, page: null });
      setPage(1);
    },
    [patchSearchParams],
  );

  const togglePhoneStatus = useCallback((): void => {
    patchSearchParams({ phoneStatus: phoneStatus ? null : 'without', page: null });
    setPage(1);
  }, [phoneStatus, patchSearchParams]);

  const toggleSelect = useCallback((id: string): void => {
    setSelectedIds((prev: string[]) =>
      prev.includes(id) ? prev.filter((i: string) => i !== id) : [...prev, id]
    );
  }, []);

  const toggleSelectAll = useCallback((): void => {
    if (selectedIds.length === contacts.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(contacts.map((c: Contact) => c.id));
    }
  }, [contacts, selectedIds.length]);

  /** 当前筛选条件（跨页批量时直接交给服务端按条件执行，无需传几千个 id） */
  const currentFilter = useCallback(() => ({
    batchId: batchId || undefined,
    tier: tier || undefined,
    tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
    archived: archived === 'all' ? undefined : archived,
    keyword: search.trim() || undefined,
  }), [batchId, tier, selectedTagIds, archived, search]);

  const handleBatchArchive = async (targetArchived: boolean): Promise<void> => {
    const useFilter = selectAllMatching;
    if (!useFilter && selectedIds.length === 0) return;
    try {
      const result = useFilter
        ? await contactsApi.batchByFilter(
            currentFilter(),
            targetArchived ? 'archive' : 'unarchive',
          )
        : await contactsApi.batchArchive(selectedIds, targetArchived);
      toast.success(targetArchived
        ? `已归档 ${result.updated} 位联系人`
        : `已取消归档 ${result.updated} 位联系人`
      );
      setSelectedIds([]);
      setSelectAllMatching(false);
      setSelectMode(false);
      void loadContacts();
    } catch (error) {
      logger.error('批量归档失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`批量归档失败：${msg}`);
    }
  };

  /** 批量打标签：作用于「本页选中」或「全部匹配」 */
  const handleBatchTag = async (tagId: string): Promise<void> => {
    if (!tagId) return;
    try {
      const result = await contactsApi.batchByFilter(currentFilter(), 'addTags', [tagId]);
      const tagName = allTags.find((t: Tag) => t.id === tagId)?.name ?? '';
      toast.success(`已为 ${result.tagsAdded ?? 0} 位联系人打上「${tagName}」`);
      setSelectedIds([]);
      setSelectAllMatching(false);
      setSelectMode(false);
      void loadContacts();
    } catch (error) {
      logger.error('批量打标签失败', error);
      toast.error('批量打标签失败');
    }
  };

  const handleArchiveToggle = async (contactId: string, archivedVal: boolean): Promise<void> => {
    try {
      const updated = await contactsApi.updateContact(contactId, { archived: archivedVal });
      toast.success(archivedVal ? '已归档' : '已取消归档');
      setSelectedContact(updated);
      void loadContacts();
    } catch (error) {
      logger.error('更新归档状态失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`更新归档状态失败：${msg}`);
    }
  };

  const handleCardClick = async (contact: Contact): Promise<void> => {
    setSelectedContact(contact);
    setDrawerOpen(true);
    setLoadingFollowups(true);
    setLoadingMergeLogs(true);
    try {
      const [fuData, mergeLogsData] = await Promise.all([
        followupsApi.getFollowupsByContact(contact.id),
        contactsApi.getContactMergeLogs(contact.id).catch(() => ({ items: [], total: 0 })),
      ]);
      setFollowups(fuData);
      setMergeLogs(mergeLogsData.items);
    } catch (error) {
      logger.error('加载联系人详情失败', error);
    } finally {
      setLoadingFollowups(false);
      setLoadingMergeLogs(false);
    }
  };

  const handleEditClick = (contact: Contact): void => {
    setEditingContact(contact);
    setFormOpen(true);
    setDrawerOpen(false);
  };

  const handleDeleteClick = async (contact: Contact): Promise<void> => {
    if (!await showConfirm(`确定要删除联系人「${contact.name}」吗？`)) return;
    try {
      await contactsApi.deleteContact(contact.id);
      toast.success('删除成功');
      void loadContacts();
    } catch (error) {
      logger.error('删除联系人失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`删除失败：${msg}`);
    }
  };

  const handleCreateClick = (): void => {
    setEditingContact(null);
    setFormOpen(true);
  };

  const handleFormSubmit = async (data: CreateContactRequest | UpdateContactRequest): Promise<void> => {
    setSubmitting(true);
    try {
      if (editingContact) {
        await contactsApi.updateContact(editingContact.id, data as UpdateContactRequest);
        toast.success('保存成功');
      } else {
        await contactsApi.createContact(data as CreateContactRequest);
        toast.success('创建成功');
      }
      setFormOpen(false);
      setEditingContact(null);
      void loadContacts();
    } catch (error) {
      logger.error('保存联系人失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`保存失败：${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddFollowup = async (data: {
    contactId: string;
    content: string;
    followupType: FollowupType;
    followupDate: string;
    nextFollowupDate?: string;
  }): Promise<void> => {
    setAddingFollowup(true);
    try {
      await followupsApi.createFollowup(data);
      toast.success('跟进记录已添加');
      const fuData = await followupsApi.getFollowupsByContact(data.contactId);
      setFollowups(fuData);
      const contactData = await contactsApi.getContact(data.contactId);
      setSelectedContact(contactData);
      void loadContacts();
    } catch (error) {
      logger.error('添加跟进记录失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`添加跟进记录失败：${msg}`);
    } finally {
      setAddingFollowup(false);
    }
  };

  const initialFormData = useMemo(() => {
    if (editingContact) {
      return {
        ...editingContact,
        tags: editingContact.tags,
      };
    }
    if (state?.defaultTier) {
      return { tier: state.defaultTier } as Partial<CreateContactRequest>;
    }
    return undefined;
  }, [editingContact, state?.defaultTier]);

  const selectedTagNames = useMemo(() => {
    return selectedTagIds
      .map((id: string) => allTags.find((t: Tag) => t.id === id)?.name)
      .filter(Boolean) as string[];
  }, [selectedTagIds, allTags]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">联系人</h2>
        <p className="text-sm text-slate-600 mt-1">
          共 {total} 位联系人
        </p>
      </div>

          {/* Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        {/* Row 1: Search + Batch + Archive */}
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={search}
              onChange={handleSearchChange}
              placeholder="搜索姓名、备注名、电话..."
              className="pl-9 w-full"
            />
          </div>

          {/* Batch Filter */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Layers className="w-4 h-4 text-slate-400" strokeWidth={1.5} />
            <Select value={batchId} onValueChange={handleBatchChange}>
              <SelectTrigger className="w-[140px] h-11 md:h-9 text-xs">
                <SelectValue placeholder="全部批次" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">全部批次</SelectItem>
                {batches.map((b: ImportBatch) => (
                  <SelectItem key={b.id} value={b.id} className="text-xs">
                    {b.name} ({b.contactCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Archive Filter */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {[
              { value: false as const, label: '活跃' },
              { value: true as const, label: '已归档' },
              { value: 'all' as const, label: '全部' },
            ].map((opt) => (
              <button
                key={String(opt.value)}
                onClick={() => handleArchiveChange(opt.value)}
                 className={`px-3 py-3 md:py-1.5 text-xs rounded-md whitespace-nowrap transition-colors flex items-center gap-1.5 border ${
                  archived === opt.value
                    ? 'bg-slate-700 text-white border-slate-700 font-medium'
                    : 'bg-white text-slate-500 border-slate-200 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                {opt.value === true && <Archive className="w-3.5 h-3.5" />}
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Tier + Tag + View + Add + Batch Actions */}
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
          {/* Tier Filter */}
          <div className="flex items-center gap-1 flex-wrap">
            {tierOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleTierClick(opt.value as ContactTier | '')}
                 className={`px-3 py-3 md:py-1.5 text-xs rounded-md whitespace-nowrap transition-colors ${
                  tier === opt.value
                    ? 'bg-amber-600 text-white font-medium'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Tag Filter + View Toggle + Add — 移动端允许换行，避免横向撑破 */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Tag Filter Dropdown */}
            <div className="relative">
              <button
                onClick={() => setTagFilterOpen(!tagFilterOpen)}
                className="flex items-center gap-1.5 px-3 py-3 md:py-2 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
              >
                <Filter className="w-4 h-4" />
                <span>
                  {selectedTagIds.length > 0
                    ? `标签 · ${selectedTagIds.length}`
                    : '标签筛选'}
                </span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {tagFilterOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setTagFilterOpen(false)}
                  />
                  <div className="absolute left-0 top-full mt-1 w-56 max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-lg shadow-md z-20 p-2 max-h-64 overflow-y-auto">
                    {allTags.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-2">暂无标签</p>
                    ) : (
                      <div className="space-y-0.5">
                        {allTags.map((tag: Tag) => {
                          const selected = selectedTagIds.includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              onClick={() => toggleTag(tag.id)}
                               className={`w-full text-left text-xs px-2 py-3 md:py-1.5 rounded-md flex items-center gap-2 transition-colors ${
                                selected
                                  ? 'bg-amber-50 text-amber-600'
                                  : 'text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              <span
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: tag.color }}
                              />
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {selectedTagIds.length > 0 && (
                      <div className="pt-2 mt-2 border-t border-slate-100">
                        <button
                          onClick={clearTagFilter}
                          className="w-full text-xs text-slate-500 hover:text-slate-700 text-center py-1"
                        >
                          清除筛选
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Selected tag chips */}
            {selectedTagIds.length > 0 && (
              <div className="hidden md:flex items-center gap-1 flex-wrap max-w-[160px]">
                {selectedTagNames.slice(0, 2).map((name: string) => (
                  <Badge key={name} variant="secondary" className="text-[10px]">
                    {name}
                  </Badge>
                ))}
                {selectedTagIds.length > 2 && (
                  <span className="text-[10px] text-slate-400">
                    +{selectedTagIds.length - 2}
                  </span>
                )}
                <button
                  onClick={clearTagFilter}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* View Toggle */}
            <div className="flex items-center bg-slate-100 rounded-md p-0.5 md:p-0.5 p-1">
              <button
                onClick={() => setView('card')}
                className={`p-2 md:p-1.5 rounded transition-colors ${
                  view === 'card'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                title="卡片视图"
              >
                <Grid3X3 className="w-5 h-5 md:w-4 md:h-4" />
              </button>
              <button
                onClick={() => setView('list')}
                className={`p-2 md:p-1.5 rounded transition-colors ${
                  view === 'list'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                title="列表视图"
              >
                <LayoutList className="w-5 h-5 md:w-4 md:h-4" />
              </button>
            </div>

            {/* Add Button */}
            {/* Batch Select Button */}
            {!selectMode ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectMode(true)}
                className="gap-1.5"
              >
                <Archive className="w-4 h-4" />
                批量操作
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectMode(false);
                  setSelectedIds([]);
                }}
                className="gap-1.5"
              >
                <X className="w-4 h-4" />
                取消选择
              </Button>
            )}

            {/* Add Button */}
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5 flex-1 lg:flex-none"
              onClick={handleCreateClick}
            >
              <Plus className="w-4 h-4" />
              新增联系人
            </Button>
          </div>
        </div>

        {/* Row 3: Followup status + phone status + mobile sort */}
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          {/* Followup Status Filter */}
          <div className="flex items-center gap-0.5 flex-shrink-0 overflow-x-auto">
            {[
              { value: '' as const, label: '全部跟进' },
              { value: 'overdue' as const, label: '逾期' },
              { value: 'today' as const, label: '今日' },
              { value: 'week' as const, label: '本周' },
              { value: 'none' as const, label: '无计划' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleFollowupStatusChange(opt.value)}
                className={`px-3 py-3 md:py-1.5 text-xs rounded-md whitespace-nowrap border transition-colors ${
                  followupStatus === opt.value
                    ? 'bg-red-600 text-white border-red-600 font-medium'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* No-phone toggle (排查 App 同步进来的无号联系人) */}
          <button
            onClick={togglePhoneStatus}
            className={`flex items-center gap-1.5 px-3 py-3 md:py-1.5 text-xs rounded-md border transition-colors flex-shrink-0 ${
              phoneStatus === 'without'
                ? 'bg-blue-600 text-white border-blue-600 font-medium'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
            }`}
            title="仅显示没有手机号的联系人"
          >
            <Smartphone className="w-3.5 h-3.5" />
            {phoneStatus === 'without' ? '无手机号' : '无手机号'}
          </button>

          {/* Mobile sort dropdown */}
          <div className="md:hidden flex items-center gap-1.5 flex-1">
            <Select value={sortBy ?? ''} onValueChange={(v) => handleSort(v as ContactsSortField)}>
              <SelectTrigger className="h-11 text-xs flex-1">
                <SelectValue placeholder="默认排序" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">默认排序</SelectItem>
                <SelectItem value="name">姓名</SelectItem>
                <SelectItem value="nickname">备注名</SelectItem>
                <SelectItem value="phone">电话</SelectItem>
                <SelectItem value="tier">层级</SelectItem>
                <SelectItem value="tag">标签</SelectItem>
                <SelectItem value="nextFollowupDate">下次跟进</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11"
              onClick={() => patchSearchParams({ sortOrder: sortOrder === 'asc' ? 'desc' : 'asc' })}
              disabled={!sortBy}
              aria-label="切换升降序"
            >
              {sortOrder === 'asc' ? (
                <ArrowUp className="w-4 h-4" />
              ) : (
                <ArrowDown className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Batch Operation Bar */}
      {selectMode && (
        <div className="bg-slate-700 text-white rounded-xl shadow-sm px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm">
            {selectAllMatching ? (
              <>已选全部匹配 <span className="font-semibold">{total}</span> 人</>
            ) : (
              <>已选 <span className="font-semibold">{selectedIds.length}</span> 人</>
            )}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {!selectAllMatching && (
              <Button
                size="sm"
                variant="outline"
                className="border-white/30 text-white hover:bg-white/10 hover:text-white"
                onClick={() => { setSelectAllMatching(true); }}
              >
                选中全部 {total} 人
              </Button>
            )}
            {selectAllMatching && (
              <Button
                size="sm"
                variant="outline"
                className="border-white/30 text-white hover:bg-white/10 hover:text-white"
                onClick={() => setSelectAllMatching(false)}
              >
                仅选本页
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="border-white/30 text-white hover:bg-white/10 hover:text-white"
              onClick={() => handleBatchArchive(false)}
              disabled={!selectAllMatching && selectedIds.length === 0}
            >
              批量取消归档
            </Button>
            <Button
              size="sm"
              className="bg-white text-slate-700 hover:bg-slate-100"
              onClick={() => handleBatchArchive(true)}
              disabled={!selectAllMatching && selectedIds.length === 0}
            >
              批量归档
            </Button>
            {/* 批量打标签：选标签后确认，作用于选中项或全部匹配项 */}
            <div className="flex items-center gap-1">
              <Select value={batchTagId} onValueChange={setBatchTagId}>
                <SelectTrigger className="w-[110px] h-8 text-xs bg-white/10 border-white/30 text-white">
                  <SelectValue placeholder="打标签" />
                </SelectTrigger>
                <SelectContent>
                  {allTags.map((t: Tag) => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="border-white/30 text-white hover:bg-white/10 hover:text-white"
                disabled={!batchTagId || (!selectAllMatching && selectedIds.length === 0)}
                onClick={() => void handleBatchTag(batchTagId)}
              >
                打标签
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
          <p className="text-sm text-slate-400">加载中...</p>
        </div>
      ) : view === 'card' ? (
        <ContactCardView
          contacts={contacts}
          onCardClick={handleCardClick}
          onEditClick={handleEditClick}
          selectMode={selectMode}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
        />
      ) : (
        <ContactListView
          contacts={contacts}
          onRowClick={handleCardClick}
          onEditClick={handleEditClick}
          onDeleteClick={handleDeleteClick}
          selectMode={selectMode}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
        />
      )}

      {/* Pagination + Page Size */}
      {!loading && contacts.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 py-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>每页</span>
            <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
              <SelectTrigger className="w-[72px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((size: number) => (
                  <SelectItem key={size} value={String(size)} className="text-xs">
                    {size === 9999 ? '全部' : size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>条</span>
          </div>
          <PaginationSimple
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
          />
        </div>
      )}

      {/* Quick scroll buttons for long lists */}
      <ScrollFab enabled={!loading && !formOpen && !drawerOpen && contacts.length > 20} />

      {/* Contact Form Dialog */}
      <ContactFormDialog
        open={formOpen}
        onOpenChange={(open: boolean) => {
          setFormOpen(open);
          if (!open) setEditingContact(null);
        }}
        initialData={initialFormData}
        onSubmit={handleFormSubmit}
        allTags={allTags}
        isEdit={!!editingContact}
        submitting={submitting}
      />

      {/* Contact Detail Drawer */}
      <ContactDetailDrawer
        contact={selectedContact}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onEdit={handleEditClick}
        followups={followups}
        loadingFollowups={loadingFollowups}
        onAddFollowup={handleAddFollowup}
        addingFollowup={addingFollowup}
        onArchiveToggle={handleArchiveToggle}
          mergeLogs={mergeLogs}
          loadingMergeLogs={loadingMergeLogs}
        />

    </div>
  );
};

export default ContactsPage;
