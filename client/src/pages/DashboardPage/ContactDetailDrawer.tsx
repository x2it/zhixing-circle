import React, { useState, useEffect } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from '@client/src/components/ui/drawer';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Textarea } from '@client/src/components/ui/textarea';
import { Label } from '@client/src/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@client/src/components/ui/popover';
import { Calendar } from '@client/src/components/ui/calendar';
import {
  Phone,
  MessageSquare,
  Edit2,
  Calendar as CalendarIcon,
  Tag,
  User,
  StickyNote,
  Plus,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import type { Contact, ContactTier, Followup, FollowupType } from '@shared/api.interface';
import { tierLabelMap, tierColorMap } from '@client/src/utils/tier-utils';
import { followupTypeLabel, followupTypeOptions } from '@client/src/utils/followup-utils';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';

interface ContactDetailDrawerProps {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (contact: Contact) => void;
  followups: Followup[];
  loadingFollowups: boolean;
  onAddFollowup?: (data: {
    contactId: string;
    content: string;
    followupType: FollowupType;
    followupDate: string;
    nextFollowupDate?: string;
  }) => void;
  addingFollowup?: boolean;
}

const ContactDetailDrawer: React.FC<ContactDetailDrawerProps> = ({
  contact,
  open,
  onOpenChange,
  onEdit,
  followups,
  loadingFollowups,
  onAddFollowup,
  addingFollowup = false,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [fuContent, setFuContent] = useState('');
  const [fuType, setFuType] = useState<string>('wechat');
  const [fuDate, setFuDate] = useState<Date>(new Date());
  const [fuNextDate, setFuNextDate] = useState<Date | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setShowForm(false);
      setFuContent('');
      setFuType('wechat');
      setFuDate(new Date());
      setFuNextDate(undefined);
    }
  }, [open, contact?.id]);

  if (!contact) return null;

  const formatDate = (dateStr?: string): string => {
    if (!dateStr) return '未设置';
    return dateStr.slice(0, 10);
  };

  const isOverdue = (dateStr?: string): boolean => {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };

  const handleSubmitFollowup = (): void => {
    if (!fuContent.trim() || !onAddFollowup) return;
    onAddFollowup({
      contactId: contact.id,
      content: fuContent.trim(),
      followupType: fuType as FollowupType,
      followupDate: fuDate.toISOString(),
      nextFollowupDate: fuNextDate ? fuNextDate.toISOString() : undefined,
    });
    setFuContent('');
    setFuNextDate(undefined);
    setShowForm(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="h-full w-full sm:max-w-md !rounded-none border-l border-slate-200">
        <DrawerHeader className="border-b border-slate-200 pb-4">
          <div className="flex items-start justify-between">
            <div>
              <DrawerTitle className="text-xl text-slate-900">{contact.name}</DrawerTitle>
              {contact.nickname && (
                <DrawerDescription className="text-sm text-slate-500 mt-1">
                  {contact.nickname}
                </DrawerDescription>
              )}
            </div>
            <Badge
              className={`${tierColorMap[contact.tier as ContactTier]?.badge || ''}`}
              variant="outline"
            >
              {tierLabelMap[contact.tier as ContactTier] || contact.tier}
            </Badge>
          </div>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Basic Info */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-slate-800 flex items-center gap-2">
              <User className="w-4 h-4 text-slate-400" />
              基本信息
            </h4>
            <div className="space-y-2 text-sm">
              {contact.phone && (
                <UniversalLink
                  to={`tel:${contact.phone}`}
                  className="flex items-center gap-2 text-sm text-slate-600 hover:text-primary no-underline"
                >
                  <Phone className="w-4 h-4 text-slate-400" />
                  <span>{contact.phone}</span>
                </UniversalLink>
              )}
              {contact.secondPhone && (
                <UniversalLink
                  to={`tel:${contact.secondPhone}`}
                  className="flex items-center gap-2 text-sm text-slate-600 hover:text-primary no-underline"
                >
                  <Phone className="w-4 h-4 text-slate-400" />
                  <span>{contact.secondPhone}</span>
                  <span className="text-xs text-slate-400">副号</span>
                </UniversalLink>
              )}
              {contact.wechat && (
                <div className="flex items-center gap-2 text-slate-600">
                  <MessageSquare className="w-4 h-4 text-slate-400" />
                  <span>{contact.wechat}</span>
                </div>
              )}
            </div>
          </div>

          {/* Memo */}
          {contact.memo && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-slate-800 flex items-center gap-2">
                <StickyNote className="w-4 h-4 text-slate-400" />
                备忘
              </h4>
              <p className="text-sm text-slate-600 bg-slate-50 rounded-md p-3 whitespace-pre-wrap leading-relaxed">
                {contact.memo}
              </p>
            </div>
          )}

          {/* Next Followup */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-slate-800 flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-slate-400" />
              下次跟进
            </h4>
            <p
              className={`text-sm ${isOverdue(contact.nextFollowupDate) ? 'text-red-500 font-medium' : 'text-slate-600'}`}
            >
              {formatDate(contact.nextFollowupDate)}
              {isOverdue(contact.nextFollowupDate) && ' · 已过期'}
            </p>
            {contact.followupNote && (
              <p className="text-sm text-slate-500 bg-slate-50 rounded-md p-3">
                {contact.followupNote}
              </p>
            )}
          </div>

          {/* Tags */}
          {contact.tags.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-slate-800 flex items-center gap-2">
                <Tag className="w-4 h-4 text-slate-400" />
                标签
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {contact.tags.map((tag) => (
                  <Badge key={tag.id} variant="secondary" className="text-xs">
                    {tag.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Add Followup Form */}
          {onAddFollowup && showForm ? (
            <div className="space-y-3 bg-slate-50 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-slate-800">添加跟进记录</h4>
                <button
                  onClick={() => setShowForm(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">跟进方式</Label>
                    <Select value={fuType} onValueChange={setFuType}>
                      <SelectTrigger className="w-full h-11 md:h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {followupTypeOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">跟进日期</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="w-full h-11 md:h-8 justify-start">
                          <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                          <span className="text-xs">{format(fuDate, 'MM-dd')}</span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={fuDate}
                          onSelect={(d: Date | undefined) => d && setFuDate(d)}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">下次跟进</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                           'w-full h-11 md:h-8 justify-start',
                          !fuNextDate && 'text-muted-foreground'
                        )}
                      >
                        <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                        <span className="text-xs">
                          {fuNextDate
                            ? format(fuNextDate, 'yyyy-MM-dd')
                            : '选择下次跟进日期'}
                        </span>
                        {fuNextDate && (
                          <X
                            className="ml-auto h-3.5 w-3.5 text-slate-400"
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation();
                              setFuNextDate(undefined);
                            }}
                          />
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={fuNextDate}
                        onSelect={setFuNextDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">跟进内容</Label>
                  <Textarea
                    value={fuContent}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setFuContent(e.target.value)
                    }
                    placeholder="记录本次跟进内容..."
                    className="min-h-[60px] text-sm"
                  />
                </div>
                <Button
                  size="sm"
                  className="w-full h-11 md:h-9 bg-amber-600 hover:bg-amber-700 text-white"
                  onClick={handleSubmitFollowup}
                  disabled={!fuContent.trim() || addingFollowup}
                >
                  {addingFollowup ? '提交中...' : '提交跟进'}
                </Button>
              </div>
            </div>
          ) : onAddFollowup ? (
            <button
              onClick={() => setShowForm(true)}
              className="w-full py-2.5 text-sm text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-lg border border-dashed border-amber-200 flex items-center justify-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              添加跟进记录
            </button>
          ) : null}

          {/* Followup History */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-slate-800">跟进记录</h4>
            {loadingFollowups ? (
              <div className="text-sm text-slate-400 text-center py-4">加载中...</div>
            ) : followups.length === 0 ? (
              <div className="text-sm text-slate-400 text-center py-4">暂无跟进记录</div>
            ) : (
              <div className="space-y-3">
                {followups.map((fu: Followup) => (
                  <div key={fu.id} className="bg-slate-50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <Badge variant="outline" className="text-xs">
                        {followupTypeLabel(fu.followupType)}
                      </Badge>
                      <span className="text-xs text-slate-400">
                        {formatDate(fu.followupDate)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 whitespace-pre-wrap">{fu.content}</p>
                    {fu.nextFollowupDate && (
                      <p className="text-xs text-slate-400 mt-2">
                        下次跟进：{formatDate(fu.nextFollowupDate)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DrawerFooter className="border-t border-slate-200 pt-4">
          <DrawerClose asChild>
            <Button variant="outline" size="sm">
              关闭
            </Button>
          </DrawerClose>
          <Button
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white"
            onClick={() => onEdit(contact)}
          >
            <Edit2 className="w-4 h-4" />
            编辑
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

export default ContactDetailDrawer;
