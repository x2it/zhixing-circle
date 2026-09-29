import React from 'react';
import { Crown, Zap, TrendingUp, User, Users, CheckCircle } from 'lucide-react';

interface RhythmItem {
  label: string;
  icon: React.FC<{ className?: string }>;
  color: string;
  dotColor: string;
  rhythm: string;
}

const rhythmItems: RhythmItem[] = [
  {
    label: 'S 成交高价值',
    icon: Crown,
    color: 'text-amber-700',
    dotColor: 'bg-amber-700',
    rhythm: '每季度维护1次',
  },
  {
    label: 'A 高意向客户',
    icon: Zap,
    color: 'text-red-600',
    dotColor: 'bg-red-600',
    rhythm: '每周跟进1次',
  },
  {
    label: 'B 已接触客户',
    icon: TrendingUp,
    color: 'text-amber-600',
    dotColor: 'bg-amber-600',
    rhythm: '每2周跟进1次',
  },
  {
    label: 'C 信息完整客户',
    icon: User,
    color: 'text-blue-600',
    dotColor: 'bg-blue-600',
    rhythm: '每月联系1次',
  },
  {
    label: 'D 线索客户',
    icon: Users,
    color: 'text-slate-500',
    dotColor: 'bg-slate-500',
    rhythm: '每2周联系1次',
  },
  {
    label: 'V 已成交客户',
    icon: CheckCircle,
    color: 'text-green-600',
    dotColor: 'bg-green-600',
    rhythm: '售后定期维护',
  },
];

const FollowupRhythmCard: React.FC = () => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-full">
      <h3 className="text-lg font-semibold text-slate-900 mb-4">跟进节奏建议</h3>
      <div className="space-y-3">
        {rhythmItems.map((item: RhythmItem) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="flex items-center gap-3 py-1"
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${item.dotColor}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <Icon className={`w-3.5 h-3.5 ${item.color} flex-shrink-0`} />
                  <span className="text-sm font-medium text-slate-800">{item.label}</span>
                </div>
              </div>
              <span className="text-xs text-slate-500 flex-shrink-0">{item.rhythm}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 pt-4 border-t border-slate-100">
        <p className="text-xs text-slate-400 leading-relaxed">
          建议：每周一早上花 10 分钟梳理本周待跟进名单，按优先级安排跟进顺序。
        </p>
      </div>
    </div>
  );
};

export default FollowupRhythmCard;
