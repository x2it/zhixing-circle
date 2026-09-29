import React from 'react';
import { Phone, MessageSquare, Calendar, Edit2 } from 'lucide-react';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import { Checkbox } from '@client/src/components/ui/checkbox';
import type { Contact, ContactTier } from '@shared/api.interface';
import { tierColorMap, tierLabelMap } from '@client/src/utils/tier-utils';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';

interface ContactCardViewProps {
  contacts: Contact[];
  onCardClick: (contact: Contact) => void;
  onEditClick: (contact: Contact) => void;
  selectMode?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
}

const ContactCardView: React.FC<ContactCardViewProps> = ({
  contacts,
  onCardClick,
  onEditClick,
  selectMode = false,
  selectedIds = [],
  onToggleSelect,
}) => {
  const formatDate = (dateStr?: string): string => {
    if (!dateStr) return '未设置';
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return `已过期${Math.abs(diffDays)}天`;
    if (diffDays === 0) return '今天跟进';
    if (diffDays === 1) return '明天跟进';
    return `${dateStr.slice(5, 10)} 跟进`;
  };

  const isOverdue = (dateStr?: string): boolean => {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };

  if (contacts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
        <p className="text-sm text-slate-400">暂无联系人</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4" data-ai-section-type="card-list">
      {contacts.map((contact: Contact) => {
        const tierColor = tierColorMap[contact.tier as ContactTier] || tierColorMap.C;
        const tierLabel = tierLabelMap[contact.tier as ContactTier] || contact.tier;
        const displayTags = contact.tags.slice(0, 3);
        const extraTagsCount = contact.tags.length - 3;

        return (
          <div
            key={contact.id}
            className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200 p-4 md:p-5 cursor-pointer group"
            onClick={() => onCardClick(contact)}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-1">
              <div className="flex items-start gap-2 min-w-0 flex-1">
                {selectMode && onToggleSelect && (
                  <div
                    className="flex-shrink-0 pt-0.5"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={selectedIds.includes(contact.id)}
                      onCheckedChange={() => onToggleSelect(contact.id)}
                    />
                  </div>
                )}
                <h4 className="text-base font-semibold text-slate-900 truncate min-w-0 flex-1">
                  {contact.name}
                </h4>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className={`w-2 h-2 rounded-full ${tierColor.dot}`} />
                <span className={`text-xs ${tierColor.text}`}>{tierLabel}</span>
              </div>
            </div>

            {/* Nickname */}
            {contact.nickname && (
              <p className="text-xs text-slate-400 mb-3 truncate">{contact.nickname}</p>
            )}
            {!contact.nickname && <div className="mb-3" />}

            {/* Phone & Wechat */}
            <div className="space-y-1.5 mb-3">
              {contact.phone && (
                <UniversalLink
                  to={`tel:${contact.phone}`}
                  className="flex items-center gap-2 text-xs text-slate-600 hover:text-primary no-underline"
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                  <Phone className="w-3.5 h-3.5 text-slate-400 hover:text-primary flex-shrink-0" />
                  <span className="truncate">{contact.phone}</span>
                </UniversalLink>
              )}
              {contact.wechat && (
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <MessageSquare className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  <span className="truncate">{contact.wechat}</span>
                </div>
              )}
            </div>

            {/* Tags */}
            <div className="flex flex-wrap gap-1 mb-3 min-h-[20px]">
              {displayTags.map((tag) => (
                <Badge key={tag.id} variant="secondary" className="text-[10px] px-1.5 py-0">
                  {tag.name}
                </Badge>
              ))}
              {extraTagsCount > 0 && (
                <span className="text-[10px] text-slate-400 px-1">+{extraTagsCount}</span>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <div className="flex items-center gap-1">
                <Calendar className={`w-3.5 h-3.5 flex-shrink-0 ${isOverdue(contact.nextFollowupDate) ? 'text-red-500' : 'text-slate-400'}`} />
                <span className={`text-xs ${isOverdue(contact.nextFollowupDate) ? 'text-red-500 font-medium' : 'text-slate-500'}`}>
                  {formatDate(contact.nextFollowupDate)}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 md:h-7 md:w-7 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onEditClick(contact);
                }}
              >
                <Edit2 className="w-4 h-4 md:w-3.5 md:h-3.5 text-slate-500" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ContactCardView;
