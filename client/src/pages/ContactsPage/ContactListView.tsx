import React from 'react';
import { Edit2, Trash2, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import { Checkbox } from '@client/src/components/ui/checkbox';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@client/src/components/ui/table';
import type { Contact, ContactTier } from '@shared/api.interface';
import { tierColorMap, tierLabelMap } from '@client/src/utils/tier-utils';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';
import { cn } from '@/lib/utils';

export type ContactsSortField =
  | 'name'
  | 'nickname'
  | 'phone'
  | 'tier'
  | 'tag'
  | 'nextFollowupDate';

interface ContactListViewProps {
  contacts: Contact[];
  onRowClick: (contact: Contact) => void;
  onEditClick: (contact: Contact) => void;
  onDeleteClick: (contact: Contact) => void;
  selectMode?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
  sortBy?: ContactsSortField | null;
  sortOrder?: 'asc' | 'desc';
  onSort?: (field: ContactsSortField) => void;
}

const SortableHead: React.FC<{
  label: string;
  field: ContactsSortField;
  sortBy?: ContactsSortField | null;
  sortOrder?: 'asc' | 'desc';
  onSort?: (field: ContactsSortField) => void;
  className?: string;
}> = ({ label, field, sortBy, sortOrder, onSort, className }) => {
  const active = sortBy === field;
  const Icon = !active ? ArrowUpDown : sortOrder === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort?.(field)}
        className="group inline-flex items-center gap-1 -mx-1 px-1 h-11 md:h-8 rounded-md touch-manipulation select-none transition-colors hover:text-foreground"
      >
        <span className={cn('whitespace-nowrap', active && 'font-medium text-foreground')}>
          {label}
        </span>
        <Icon
          className={cn(
            'w-3.5 h-3.5 shrink-0',
            active ? 'text-primary' : 'text-muted-foreground/50 group-hover:text-muted-foreground',
          )}
        />
      </button>
    </TableHead>
  );
};

const ContactListView: React.FC<ContactListViewProps> = ({
  contacts,
  onRowClick,
  onEditClick,
  onDeleteClick,
  selectMode = false,
  selectedIds = [],
  onToggleSelect,
  onToggleSelectAll,
  sortBy,
  sortOrder,
  onSort,
}) => {
  const hasSelect = selectMode && !!onToggleSelect && !!onToggleSelectAll;
  const allSelected = contacts.length > 0 && selectedIds.length === contacts.length;
  if (contacts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
        <p className="text-sm text-slate-400">暂无联系人</p>
      </div>
    );
  }

  const sortProps = { sortBy, sortOrder, onSort };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            {hasSelect && (
              <TableHead className="w-10">
                <Checkbox checked={allSelected} onCheckedChange={onToggleSelectAll} />
              </TableHead>
            )}
            <SortableHead label="姓名" field="name" {...sortProps} />
            <SortableHead
              label="备注名"
              field="nickname"
              {...sortProps}
              className="hidden md:table-cell"
            />
            <SortableHead label="电话" field="phone" {...sortProps} />
            <SortableHead label="层级" field="tier" {...sortProps} />
            <SortableHead
              label="标签"
              field="tag"
              {...sortProps}
              className="hidden md:table-cell"
            />
            <SortableHead label="下次跟进" field="nextFollowupDate" {...sortProps} />
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((contact: Contact) => {
            const tierColor = tierColorMap[contact.tier as ContactTier] || tierColorMap.C;
            const tierLabel = tierLabelMap[contact.tier as ContactTier] || contact.tier;
            const displayTags = contact.tags.slice(0, 2);
            const extraTagsCount = contact.tags.length - 2;
            const isOverdue =
              contact.nextFollowupDate &&
              new Date(contact.nextFollowupDate) < new Date(new Date().setHours(0, 0, 0, 0));

            return (
              <TableRow
                key={contact.id}
                className="cursor-pointer h-14 md:h-10"
                onClick={() => onRowClick(contact)}
              >
                {hasSelect && (
                  <TableCell onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.includes(contact.id)}
                      onCheckedChange={() => onToggleSelect?.(contact.id)}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <span className="font-medium text-slate-800">{contact.name}</span>
                </TableCell>
                <TableCell className="text-slate-500 hidden md:table-cell">
                  {contact.nickname || '-'}
                </TableCell>
                <TableCell className="text-slate-500">
                  {contact.phone ? (
                    <UniversalLink
                      to={`tel:${contact.phone}`}
                      className="text-slate-500 hover:text-primary no-underline"
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                      {contact.phone}
                    </UniversalLink>
                  ) : (
                    '-'
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${tierColor.dot}`} />
                    <span className={`text-xs ${tierColor.text}`}>{tierLabel}</span>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="flex gap-1 flex-wrap">
                    {displayTags.map((tag) => (
                      <Badge key={tag.id} variant="secondary" className="text-[10px] px-1.5 py-0">
                        {tag.name}
                      </Badge>
                    ))}
                    {extraTagsCount > 0 && (
                      <span className="text-[10px] text-slate-400">+{extraTagsCount}</span>
                    )}
                    {contact.tags.length === 0 && (
                      <span className="text-slate-400 text-xs">-</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {contact.nextFollowupDate ? (
                    <span className={isOverdue ? 'text-red-500' : 'text-slate-600'}>
                      {contact.nextFollowupDate.slice(0, 10)}
                    </span>
                  ) : (
                    <span className="text-slate-400">-</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 md:h-8 md:w-8"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        onEditClick(contact);
                      }}
                    >
                      <Edit2 className="w-4 h-4 text-slate-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 md:h-8 md:w-8 hover:text-red-600 hover:bg-red-50"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        onDeleteClick(contact);
                      }}
                    >
                      <Trash2 className="w-4 h-4 text-slate-500" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

export default ContactListView;
