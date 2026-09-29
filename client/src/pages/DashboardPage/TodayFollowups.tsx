import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, CalendarClock, PhoneCall } from 'lucide-react';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import type { Contact, ContactTier } from '@shared/api.interface';
import { tierColorMap, tierLabelMap } from '@client/src/utils/tier-utils';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';

interface TodayFollowupsProps {
  contacts: Contact[];
  onContactClick: (contact: Contact) => void;
  onQuickFollowup: (contact: Contact) => void;
}

const TodayFollowups: React.FC<TodayFollowupsProps> = ({
  contacts,
  onContactClick,
  onQuickFollowup,
}) => {
  const navigate = useNavigate();

  const displayContacts = contacts.slice(0, 7);
  const hasMore = contacts.length > 7;

  const formatDate = (dateStr?: string): string => {
    if (!dateStr) return '';
    return dateStr.slice(5, 10);
  };

  const isOverdue = (dateStr?: string): boolean => {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-900">今日待跟进</h3>
        <span className="text-xs text-slate-400">共 {contacts.length} 条</span>
      </div>

      <div className="space-y-3">
        {displayContacts.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-400">
            <CalendarClock className="w-8 h-8 mx-auto mb-2 opacity-50" />
            今日暂无待跟进
          </div>
        ) : (
          displayContacts.map((contact: Contact) => {
            const tierColor = tierColorMap[contact.tier as ContactTier] || tierColorMap.C;
            const tierLabel = tierLabelMap[contact.tier as ContactTier] || contact.tier;
            return (
              <div
                key={contact.id}
                className="flex items-center justify-between p-3 md:p-3 py-3.5 md:py-3 rounded-lg hover:bg-slate-50 transition-colors group"
              >
                <div
                  className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                  onClick={() => onContactClick(contact)}
                >
                  <div className="w-10 h-10 md:w-9 md:h-9 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm md:text-sm font-medium text-slate-600">
                      {contact.name.charAt(0)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-800 truncate">{contact.name}</p>
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 ${tierColor.badge}`}
                      >
                        {tierLabel}
                      </Badge>
                    </div>
                    {contact.followupNote && (
                      <p className="text-xs text-slate-400 truncate max-w-[240px] mt-0.5">
                        {contact.followupNote}
                      </p>
                    )}
                    {contact.phone && (
                      <UniversalLink
                        to={`tel:${contact.phone}`}
                        className="flex items-center gap-1 text-xs text-slate-600 hover:text-primary no-underline mt-0.5"
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                      >
                        <PhoneCall className="w-3 h-3 text-slate-400" />
                        <span className="truncate max-w-[180px]">{contact.phone}</span>
                      </UniversalLink>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className={`text-xs ${isOverdue(contact.nextFollowupDate) ? 'text-red-500 font-medium' : 'text-slate-500'}`}
                  >
                    {formatDate(contact.nextFollowupDate)}
                  </span>
                  <Button
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white h-9 md:h-7 px-3 md:px-2.5 text-xs gap-1"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      onQuickFollowup(contact);
                    }}
                  >
                    <PhoneCall className="w-3 h-3" />
                    立即跟进
                  </Button>
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors hidden sm:block" />
                </div>
              </div>
            );
          })
        )}
      </div>

      {hasMore && (
        <button
          onClick={() => navigate('/contacts')}
          className="w-full mt-3 py-3 md:py-2 text-xs md:text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 rounded-md transition-colors"
        >
          查看全部 →
        </button>
      )}
    </div>
  );
};

export default TodayFollowups;
