import React from 'react';
import {
  Users,
  Crown,
  Zap,
  CheckCircle,
  CalendarClock,
} from 'lucide-react';
import type { DashboardStats } from '@shared/api.interface';

interface StatsCardsProps {
  stats: DashboardStats;
}

interface StatCardConfig {
  key: keyof DashboardStats;
  label: string;
  icon: React.FC<{ className?: string }>;
  iconBg: string;
  iconColor: string;
  numberColor: string;
}

const statConfigs: StatCardConfig[] = [
  {
    key: 'totalContacts',
    label: '总联系人',
    icon: Users,
    iconBg: 'bg-slate-100',
    iconColor: 'text-slate-700',
    numberColor: 'text-slate-900',
  },
  {
    key: 'tierSCount',
    label: 'S类',
    icon: Crown,
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-700',
    numberColor: 'text-amber-700',
  },
  {
    key: 'tierACount',
    label: 'A类',
    icon: Zap,
    iconBg: 'bg-red-50',
    iconColor: 'text-red-600',
    numberColor: 'text-red-600',
  },
  {
    key: 'tierVCount',
    label: 'V类',
    icon: CheckCircle,
    iconBg: 'bg-green-50',
    iconColor: 'text-green-600',
    numberColor: 'text-green-600',
  },
  {
    key: 'weekFollowupCount',
    label: '本周待跟进',
    icon: CalendarClock,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    numberColor: 'text-amber-600',
  },
];

const StatsCards: React.FC<StatsCardsProps> = ({ stats }) => {
  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 md:gap-4"
      data-ai-section-type="card-stat"
    >
      {statConfigs.map((config: StatCardConfig) => {
        const Icon = config.icon;
        return (
          <div
            key={config.key}
            className="bg-card rounded-lg border border-border hover:shadow-md transition-all duration-200 p-3 md:p-4"
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center ${config.iconBg}`}
              >
                <Icon className={`w-5 h-5 ${config.iconColor}`} />
              </div>
            </div>
            <div className="mt-3">
              <p className="text-xs md:text-sm text-slate-500">{config.label}</p>
              <p className={`text-2xl md:text-3xl font-semibold mt-1 ${config.numberColor}`}>
                {stats[config.key] as number}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default StatsCards;
