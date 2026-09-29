import React from 'react';
import { Plus } from 'lucide-react';
import type { TierContactGroup, Contact, ContactTier } from '@shared/api.interface';

interface TierBoardProps {
  groups: TierContactGroup[];
  onContactClick: (contact: Contact) => void;
  onAddClick: (tier: ContactTier) => void;
}

const tierColors: Record<ContactTier, string> = {
  S: 'bg-amber-700',
  A: 'bg-red-600',
  B: 'bg-amber-600',
  C: 'bg-blue-600',
  D: 'bg-slate-500',
  V: 'bg-green-600',
};

const tierBadgeColors: Record<ContactTier, string> = {
  S: 'bg-amber-100 text-amber-800 border-amber-200',
  A: 'bg-red-50 text-red-600 border-red-200',
  B: 'bg-amber-50 text-amber-600 border-amber-200',
  C: 'bg-blue-50 text-blue-600 border-blue-200',
  D: 'bg-slate-100 text-slate-600 border-slate-200',
  V: 'bg-green-50 text-green-600 border-green-200',
};

const TierBoard: React.FC<TierBoardProps> = ({ groups, onContactClick, onAddClick }) => {
  const formatDate = (dateStr?: string): string => {
    if (!dateStr) return '未设置';
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return `已过期${Math.abs(diffDays)}天`;
    if (diffDays === 0) return '今天';
    if (diffDays === 1) return '明天';
    if (diffDays <= 7) return `${diffDays}天后`;
    return dateStr.slice(0, 10);
  };

  const isOverdue = (dateStr?: string): boolean => {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <h3 className="text-lg font-semibold text-slate-900 mb-4">客户分层看板</h3>
      {/* 自适应网格：窄屏 1 列 / 中屏 2 列 / 宽屏 3 列，不再横向滚动 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
        {groups.map((group: TierContactGroup) => {
          const visible = group.contacts.slice(0, 6);
          const hidden = group.contacts.length - visible.length;
          return (
          <div
            key={group.tier}
            className="w-full bg-slate-50 rounded-lg p-3 flex flex-col"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${tierColors[group.tier]}`} />
                <span className="text-sm font-medium text-slate-800">{group.label}</span>
                <span className="text-xs text-slate-400 bg-white rounded-full px-2 py-0.5 border border-slate-200">
                  {group.contacts.length}
                </span>
              </div>
            </div>

            {/* 每档最多展示 6 位，超出折叠为一行提示，避免列内出现滚动条 */}
            <div className="flex-1 space-y-2">
              {group.contacts.length === 0 ? (
                <div className="text-xs text-slate-400 text-center py-4">暂无联系人</div>
              ) : (
                <>
                  {visible.map((contact: Contact) => (
                  <div
                    key={contact.id}
                    onClick={() => onContactClick(contact)}
                    className="bg-white rounded-lg border border-slate-200 p-3 cursor-pointer hover:shadow-sm hover:border-slate-300 transition-all duration-200"
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-sm font-medium text-slate-900 truncate max-w-[120px]">
                        {contact.name}
                      </span>
                    </div>
                    {contact.nickname && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{contact.nickname}</p>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <span className={`text-xs ${isOverdue(contact.nextFollowupDate) ? 'text-red-500' : 'text-slate-400'}`}>
                        {contact.nextFollowupDate ? formatDate(contact.nextFollowupDate) : '暂无跟进'}
                      </span>
                      {contact.tags[0] && (
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${tierBadgeColors[contact.tier]}`}>
                          {contact.tags[0].name}
                        </span>
                      )}
                    </div>
                  </div>
                  ))}
                  {hidden > 0 && (
                    <div className="text-[11px] text-slate-400 text-center pt-1">
                      还有 {hidden} 位，去联系人页查看全部
                    </div>
                  )}
                </>
              )}
            </div>

            <button
              onClick={() => onAddClick(group.tier)}
              className="mt-3 w-full py-2 text-xs text-slate-500 hover:text-slate-700 hover:bg-white rounded-md border border-dashed border-slate-300 flex items-center justify-center gap-1 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              添加到{group.label}
            </button>
          </div>
          );
        })}
      </div>
    </div>
  );
};

export default TierBoard;
