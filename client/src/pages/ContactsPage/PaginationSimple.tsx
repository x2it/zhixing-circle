import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

const PaginationSimple: React.FC<PaginationProps> = ({ page, pageSize, total, onPageChange }) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  const getPageNumbers = (): number[] => {
    const pages: number[] = [];
    const maxVisible = 5;
    let start = Math.max(1, page - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);
    start = Math.max(1, end - maxVisible + 1);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  };

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-1 py-2">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => onPageChange(page - 1)}
        disabled={!canPrev}
      >
        <ChevronLeft className="w-4 h-4" />
      </Button>

      {getPageNumbers().map((p: number) => (
        <Button
          key={p}
          variant={p === page ? 'default' : 'ghost'}
          size="icon"
          className={`h-8 w-8 ${p === page ? 'bg-amber-600 hover:bg-amber-700 text-white' : ''}`}
          onClick={() => onPageChange(p)}
        >
          {p}
        </Button>
      ))}

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => onPageChange(page + 1)}
        disabled={!canNext}
      >
        <ChevronRight className="w-4 h-4" />
      </Button>

      <span className="ml-3 text-xs text-slate-400">
        共 {total} 条 / {totalPages} 页
      </span>
    </div>
  );
};

export default PaginationSimple;
