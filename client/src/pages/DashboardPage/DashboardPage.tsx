import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { AlertCircle, RefreshCw } from 'lucide-react';
import StatsCards from './StatsCards';
import TierBoard from './TierBoard';
import TodayFollowups from './TodayFollowups';
import RecentActivities from './RecentActivities';
import FollowupRhythmCard from './FollowupRhythmCard';
import ContactDetailDrawer from './ContactDetailDrawer';
import * as dashboardApi from '@client/src/api/dashboard';
import * as followupsApi from '@client/src/api/followups';
import * as contactsApi from '@client/src/api/contacts';
import * as batchesApi from '@client/src/api/batches';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { Button } from '@client/src/components/ui/button';
import type {
  DashboardStats,
  TierContactGroup,
  Contact,
  DashboardActivity,
  Followup,
  ContactTier,
  FollowupType,
  ImportBatch,
} from '@shared/api.interface';

interface LoadError {
  message: string;
}

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<LoadError | null>(null);

  const [tierGroups, setTierGroups] = useState<TierContactGroup[]>([]);
  const [tierLoading, setTierLoading] = useState(true);
  const [tierError, setTierError] = useState<LoadError | null>(null);

  const [todayFollowups, setTodayFollowups] = useState<Contact[]>([]);
  const [todayLoading, setTodayLoading] = useState(true);
  const [todayError, setTodayError] = useState<LoadError | null>(null);

  const [recentActivities, setRecentActivities] = useState<DashboardActivity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [activitiesError, setActivitiesError] = useState<LoadError | null>(null);

  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [loadingFollowups, setLoadingFollowups] = useState(false);
  const [addingFollowup, setAddingFollowup] = useState(false);

  useEffect(() => {
    void loadBatches();
  }, []);

  useEffect(() => {
    void loadAllDashboardData();
  }, [selectedBatchId]);

  const loadBatches = async (): Promise<void> => {
    try {
      const data = await batchesApi.getBatches();
      setBatches(data);
    } catch (error) {
      logger.error('加载批次列表失败', error);
    }
  };

  const extractErrorMessage = (error: unknown): string => {
    if (error && typeof error === 'object' && 'response' in error) {
      const resp = (error as { response?: { data?: { message?: string; error?: string } } }).response;
      if (resp?.data?.message) return resp.data.message;
      if (resp?.data?.error) return resp.data.error;
    }
    if (error instanceof Error) return error.message;
    return '未知错误';
  };

  const loadAllDashboardData = async (): Promise<void> => {
    const batchId = selectedBatchId || undefined;

    const statsPromise = (async () => {
      setStatsLoading(true);
      setStatsError(null);
      try {
        const data = await dashboardApi.getDashboardStats(batchId);
        setStats(data);
      } catch (error) {
        const msg = extractErrorMessage(error);
        logger.error('获取仪表盘统计失败', error);
        setStatsError({ message: msg });
      } finally {
        setStatsLoading(false);
      }
    })();

    const tierPromise = (async () => {
      setTierLoading(true);
      setTierError(null);
      try {
        const data = await dashboardApi.getTierGroups(batchId);
        setTierGroups(data);
      } catch (error) {
        const msg = extractErrorMessage(error);
        logger.error('获取层级分组失败', error);
        setTierError({ message: msg });
      } finally {
        setTierLoading(false);
      }
    })();

    const todayPromise = (async () => {
      setTodayLoading(true);
      setTodayError(null);
      try {
        const data = await dashboardApi.getTodayFollowups(batchId);
        setTodayFollowups(data);
      } catch (error) {
        const msg = extractErrorMessage(error);
        logger.error('获取今日待跟进失败', error);
        setTodayError({ message: msg });
      } finally {
        setTodayLoading(false);
      }
    })();

    const activitiesPromise = (async () => {
      setActivitiesLoading(true);
      setActivitiesError(null);
      try {
        const data = await dashboardApi.getRecentActivities();
        setRecentActivities(data);
      } catch (error) {
        const msg = extractErrorMessage(error);
        logger.error('获取最近动态失败', error);
        setActivitiesError({ message: msg });
      } finally {
        setActivitiesLoading(false);
      }
    })();

    await Promise.all([statsPromise, tierPromise, todayPromise, activitiesPromise]);
  };

  const handleContactClick = async (contact: Contact): Promise<void> => {
    setSelectedContact(contact);
    setDrawerOpen(true);
    setFollowups([]);
    setLoadingFollowups(true);
    try {
      const data = await followupsApi.getFollowupsByContact(contact.id);
      setFollowups(data);
    } catch (error) {
      logger.error('获取跟进记录失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`获取跟进记录失败：${msg}`);
    } finally {
      setLoadingFollowups(false);
    }
  };

  const handleAddClick = (tier: ContactTier): void => {
    navigate('/contacts', { state: { defaultTier: tier, openCreate: true } });
  };

  const handleEditContact = (contact: Contact): void => {
    setDrawerOpen(false);
    navigate('/contacts', { state: { editContactId: contact.id } });
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
      void loadAllDashboardData();
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

  const ErrorBox: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
      <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-red-800">加载失败</p>
        <p className="text-xs text-red-600 mt-0.5 break-all">{message}</p>
      </div>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          className="flex-shrink-0 h-8 text-xs border-red-200 text-red-600 hover:bg-red-100"
          onClick={onRetry}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1" />
          重试
        </Button>
      )}
    </div>
  );

  const LoadingBox: React.FC = () => (
    <div className="bg-card rounded-lg border border-border p-4 md:p-5">
      <p className="text-sm text-muted-foreground">加载中...</p>
    </div>
  );

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Page Header */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0 flex-shrink-0">
            <h2 className="text-lg md:text-2xl font-semibold text-foreground whitespace-nowrap">人脉数据概览</h2>
            <p className="text-xs md:text-sm text-muted-foreground mt-1">联系人分层与跟进进度总览</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">批次筛选</span>
            <Select value={selectedBatchId} onValueChange={setSelectedBatchId}>
              <SelectTrigger className="w-[160px] h-9 text-xs">
                <SelectValue placeholder="全部批次" />
              </SelectTrigger>
              <SelectContent>
              <SelectItem value="" className="text-xs">全部批次</SelectItem>
              {batches.map((b: ImportBatch) => (
                <SelectItem key={b.id} value={b.id} className="text-xs">
                  {b.name}（{b.contactCount}人）
                </SelectItem>
              ))}
            </SelectContent>
            </Select>
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            共 {batches.length} 个批次 · {stats?.totalContacts ?? 0} 位联系人
          </span>
        </div>
      </div>

      {statsError ? (
        <ErrorBox message={`统计数据：${statsError.message}`} onRetry={() => void loadAllDashboardData()} />
      ) : statsLoading ? (
        <LoadingBox />
      ) : stats ? (
        <StatsCards stats={stats} />
      ) : null}

      {tierError ? (
        <ErrorBox message={`分层看板：${tierError.message}`} />
      ) : tierLoading ? (
        <LoadingBox />
      ) : (
        <TierBoard
          groups={tierGroups}
          onContactClick={handleContactClick}
          onAddClick={handleAddClick}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5">
        <div className="lg:col-span-2">
          {todayError ? (
            <ErrorBox message={`今日待跟进：${todayError.message}`} />
          ) : todayLoading ? (
            <LoadingBox />
          ) : (
            <TodayFollowups
              contacts={todayFollowups}
              onContactClick={handleContactClick}
              onQuickFollowup={handleContactClick}
            />
          )}
        </div>
        <div className="lg:col-span-1">
          <FollowupRhythmCard />
        </div>
      </div>

      {activitiesError ? (
        <ErrorBox message={`最近动态：${activitiesError.message}`} />
      ) : activitiesLoading ? (
        <LoadingBox />
      ) : (
        <RecentActivities activities={recentActivities} />
      )}

      <ContactDetailDrawer
        contact={selectedContact}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onEdit={handleEditContact}
        followups={followups}
        loadingFollowups={loadingFollowups}
        onAddFollowup={handleAddFollowup}
        addingFollowup={addingFollowup}
      />
    </div>
  );
};

export default DashboardPage;
