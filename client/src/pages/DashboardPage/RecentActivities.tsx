import React from 'react';
import { Phone, MessageSquare, Home, Users } from 'lucide-react';
import type { DashboardActivity, FollowupType } from '@shared/api.interface';

interface RecentActivitiesProps {
  activities: DashboardActivity[];
}

const followupTypeConfig: Record<string, { label: string; icon: React.FC<{ className?: string }>; color: string }> = {
  phone: { label: '电话', icon: Phone, color: 'bg-blue-100 text-blue-600' },
  wechat: { label: '微信', icon: MessageSquare, color: 'bg-green-100 text-green-600' },
  visit: { label: '拜访', icon: Home, color: 'bg-amber-100 text-amber-600' },
  meeting: { label: '面谈', icon: Users, color: 'bg-violet-100 text-violet-600' },
};

const getTypeConfig = (type: FollowupType) => {
  return followupTypeConfig[type] || { label: type, icon: MessageSquare, color: 'bg-slate-100 text-slate-600' };
};

const RecentActivities: React.FC<RecentActivitiesProps> = ({ activities }) => {
  const formatTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;
    return dateStr.slice(5, 16);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-900">最近跟进动态</h3>
        <span className="text-xs text-slate-400">共 {activities.length} 条</span>
      </div>

      <div className="relative">
        {activities.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-400">
            暂无跟进记录
          </div>
        ) : (
          <div className="space-y-4">
            {activities.map((activity: DashboardActivity, index: number) => {
              const config = getTypeConfig(activity.followupType);
              const Icon = config.icon;
              return (
                <div key={activity.id} className="flex gap-3">
                  {/* Timeline */}
                  <div className="flex flex-col items-center">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${config.color}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    {index < activities.length - 1 && (
                      <div className="w-px flex-1 bg-slate-200 mt-1" />
                    )}
                  </div>
                  {/* Content */}
                  <div className="flex-1 pb-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">{activity.contactName}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${config.color}`}>
                        {config.label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{formatTime(activity.followupDate)}</p>
                    <p className="text-sm text-slate-600 mt-1.5 line-clamp-2">{activity.content}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default RecentActivities;
