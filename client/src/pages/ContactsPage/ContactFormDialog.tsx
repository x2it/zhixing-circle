import React, { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
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
import { Badge } from '@client/src/components/ui/badge';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import type {
  CreateContactRequest,
  UpdateContactRequest,
  ContactTier,
  Tag,
} from '@shared/api.interface';
import { tierOptions } from '@client/src/utils/tier-utils';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface ContactFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: Partial<CreateContactRequest> & { id?: string; tags?: Tag[] };
  onSubmit: (data: CreateContactRequest | UpdateContactRequest) => void;
  allTags: Tag[];
  isEdit?: boolean;
  submitting?: boolean;
}

const nicknamePrefixes = [
  { key: 'm', label: '买', prefix: 'm买-' },
  { key: 's', label: '售', prefix: 's售-' },
  { key: 'k', label: '租', prefix: 'k租-' },
  { key: 'c', label: '同', prefix: 'c同-' },
  { key: 'p', label: '友', prefix: 'p友-' },
];

const ContactFormDialog: React.FC<ContactFormDialogProps> = ({
  open,
  onOpenChange,
  initialData,
  onSubmit,
  allTags,
  isEdit = false,
  submitting = false,
}) => {
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState('');
  const [secondPhone, setSecondPhone] = useState('');
  const [wechat, setWechat] = useState('');
  const [tier, setTier] = useState<ContactTier | ''>('C');
  const [nextFollowupDate, setNextFollowupDate] = useState<Date | undefined>(undefined);
  const [followupNote, setFollowupNote] = useState('');
  const [memo, setMemo] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(initialData?.name || '');
      setNickname(initialData?.nickname || '');
      setPhone(initialData?.phone || '');
      setSecondPhone(initialData?.secondPhone || '');
      setWechat(initialData?.wechat || '');
      setTier((initialData?.tier as ContactTier) || 'C');
      setNextFollowupDate(initialData?.nextFollowupDate ? new Date(initialData.nextFollowupDate) : undefined);
      setFollowupNote(initialData?.followupNote || '');
      setMemo(initialData?.memo || '');
      setSelectedTagIds(initialData?.tags?.map((t: Tag) => t.id) || []);
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [open, initialData]);

  const handlePrefixClick = (prefix: string): void => {
    setNickname(prefix + nickname.replace(/^[a-zA-Z][\u4e00-\u9fa5]-/, ''));
  };

  const toggleTag = (tagId: string): void => {
    setSelectedTagIds((prev: string[]) =>
      prev.includes(tagId) ? prev.filter((id: string) => id !== tagId) : [...prev, tagId]
    );
  };

  const handleSubmit = (): void => {
    if (!name.trim()) return;

    const data: CreateContactRequest = {
      name: name.trim(),
      nickname: nickname.trim() || undefined,
      phone: phone.trim() || undefined,
      secondPhone: secondPhone.trim() || undefined,
      wechat: wechat.trim() || undefined,
      tier: (tier || 'C') as ContactTier,
      memo: memo.trim() || undefined,
      nextFollowupDate: nextFollowupDate ? nextFollowupDate.toISOString() : undefined,
      followupNote: followupNote.trim() || undefined,
      tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
    };

    onSubmit(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑联系人' : '新建联系人'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label>姓名 <span className="text-red-500">*</span></Label>
            <Input
              ref={nameInputRef}
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              placeholder="请输入姓名"
            />
          </div>

          {/* Nickname with prefixes */}
          <div className="space-y-1.5">
            <Label>备注名</Label>
            <div className="flex gap-2">
              <Input
                value={nickname}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNickname(e.target.value)}
                placeholder="如：m买-张先生"
                className="flex-1"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {nicknamePrefixes.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => handlePrefixClick(p.prefix)}
                  className="text-xs px-2 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                >
                  {p.key} {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* 电话 & 副号 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>电话</Label>
              <Input
                value={phone}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
                placeholder="手机号码"
              />
            </div>
            <div className="space-y-1.5">
              <Label>副号</Label>
              <Input
                value={secondPhone}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSecondPhone(e.target.value)}
                placeholder="第二个号码（可选）"
              />
            </div>
          </div>

          {/* Wechat */}
          <div className="space-y-1.5">
            <Label>微信</Label>
            <Input
              value={wechat}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWechat(e.target.value)}
              placeholder="微信号"
            />
          </div>

          {/* Tier */}
          <div className="space-y-1.5">
            <Label>客户层级</Label>
            <Select value={tier} onValueChange={(val: string) => setTier(val as ContactTier | '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择层级" />
              </SelectTrigger>
              <SelectContent>
                {tierOptions.filter((o) => o.value !== '').map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Next Followup */}
          <div className="space-y-1.5">
            <Label>下次跟进时间</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !nextFollowupDate && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {nextFollowupDate ? format(nextFollowupDate, 'yyyy-MM-dd') : '选择日期'}
                  {nextFollowupDate && (
                    <X
                      className="ml-auto h-4 w-4 text-slate-400 hover:text-slate-600"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        setNextFollowupDate(undefined);
                      }}
                    />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={nextFollowupDate}
                  onSelect={setNextFollowupDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Followup Note */}
          <div className="space-y-1.5">
            <Label>跟进备注</Label>
            <Textarea
              value={followupNote}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFollowupNote(e.target.value)}
              placeholder="记录跟进情况或备注信息..."
              className="min-h-[80px]"
            />
          </div>

          {/* Memo */}
          <div className="space-y-1.5">
            <Label>备忘（客户画像）</Label>
            <Textarea
              value={memo}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMemo(e.target.value)}
              placeholder="记录预算、家庭情况、偏好等静态信息..."
              className="min-h-[80px]"
            />
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <Label>标签</Label>
            <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 border border-slate-200 rounded-md">
              {allTags.length === 0 ? (
                <span className="text-xs text-slate-400">暂无标签，请先在标签管理中创建</span>
              ) : (
                allTags.map((tag: Tag) => {
                  const selected = selectedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={cn(
                        'text-xs px-2 py-0.5 rounded-md border transition-colors',
                        selected
                          ? 'bg-amber-50 text-amber-600 border-amber-200'
                          : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                      )}
                    >
                      {tag.name}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button
            className="bg-amber-600 hover:bg-amber-700 text-white"
            onClick={handleSubmit}
            disabled={!name.trim() || submitting}
          >
            {isEdit ? '保存修改' : '创建联系人'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ContactFormDialog;
