/**
 * 批次操作统一确认弹窗（时光机）
 *
 * 回滚与删除共用一个弹窗，替代原先 4 套分散的确认对话框：
 * - action='revert'：保守回滚，仅清除未被后续改动过的联系人；
 *   勾选单个批次时拉取 diff 预览（将删除/将保留明细），批量时给出汇总说明。
 * - action='delete'：彻底删除，不可恢复，需输入「删除」二次确认。
 *
 * 单条操作与批量操作共用此路径（单条 = 只勾 1 条），避免重复入口。
 */
import React, { useEffect, useState } from 'react';
import { Loader2, AlertTriangle, Undo2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@client/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import * as batchesApi from '@client/src/api/batches';
import type { BatchDiffResponse } from '@shared/api.interface';

const DELETE_CONFIRM_TEXT = '删除';

export type BatchAction = 'revert' | 'delete';

const BatchConfirmDialog: React.FC<{
  open: boolean;
  action: BatchAction | null;
  pickedCount: number;
  contactsCount: number;
  running: boolean;
  /** 回滚单个批次时拉取 diff 预览用 */
  singleBatchId?: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}> = ({
  open,
  action,
  pickedCount,
  contactsCount,
  running,
  singleBatchId,
  onConfirm,
  onOpenChange,
}) => {
  const isDelete = action === 'delete';
  const [confirmText, setConfirmText] = useState('');
  // 回滚单批次时的 diff 预览
  const [diff, setDiff] = useState<BatchDiffResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirmText('');
      setDiff(null);
      return;
    }
    // 打开时：回滚单个批次 → 拉预览；其余场景不需要
    if (action === 'revert' && pickedCount === 1 && singleBatchId) {
      setDiffLoading(true);
      batchesApi
        .getBatchDiff(singleBatchId)
        .then(setDiff)
        .catch(() => {
          // 预览失败不阻塞执行，只提示
          toast.error('获取回滚预览失败，可直接确认执行');
        })
        .finally(() => setDiffLoading(false));
    }
  }, [open, action, pickedCount, singleBatchId]);

  const confirmReady = isDelete ? confirmText.trim() === DELETE_CONFIRM_TEXT : true;

  const close = () => {
    if (running) return;
    setConfirmText('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => { if (!o) close(); else onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle
            className={`flex items-center gap-2 ${isDelete ? 'text-red-600' : 'text-amber-600'}`}
          >
            {isDelete ? (
              <AlertTriangle className="w-4 h-4" strokeWidth={1.5} />
            ) : (
              <Undo2 className="w-4 h-4" strokeWidth={1.5} />
            )}
            {isDelete ? `彻底删除 ${pickedCount} 个批次` : `回滚 ${pickedCount} 个批次`}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3">
              {isDelete ? (
                <>
                  <p>
                    与回滚不同，这是<span className="font-medium text-red-600">不可恢复</span>的彻底清理：
                    批次记录连同其名下 <span className="font-medium">{contactsCount}</span>{' '}
                    个联系人、跟进记录、标签关联一并删除。
                  </p>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">
                      确认请输入{' '}
                      <span className="font-mono font-semibold text-red-600">{DELETE_CONFIRM_TEXT}</span>
                    </label>
                    <input
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder={DELETE_CONFIRM_TEXT}
                      className="w-full h-8 px-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-red-400 font-mono"
                      autoComplete="off"
                    />
                  </div>
                </>
              ) : (
                <>
                  <p>
                    约 <span className="font-medium">{contactsCount}</span>{' '}
                    个联系人，采用<strong>保守回滚</strong>：
                    只删除未被后续操作改动过的数据，被动过自动保留，逐批次独立执行。
                  </p>
                  {diffLoading && (
                    <p className="text-xs text-slate-400 flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" /> 正在获取回滚预览…
                    </p>
                  )}
                  {diff && pickedCount === 1 && (
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-md border border-red-200 bg-red-50/60 p-3">
                        <p className="font-medium text-red-700">将删除 {diff.willDelete} 条</p>
                        <p className="text-xs text-red-600/80 mt-1">该批次新建且未被改动</p>
                      </div>
                      <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
                        <p className="font-medium text-amber-700">将保留 {diff.willKeep} 条</p>
                        <p className="text-xs text-amber-600/80 mt-1">已被后续操作改动</p>
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-slate-500">其他批次的数据不受任何影响。</p>
                </>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" disabled={running} onClick={close}>
            取消
          </Button>
          <Button
            className={isDelete ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-amber-600 hover:bg-amber-700 text-white'}
            disabled={running || !confirmReady}
            onClick={onConfirm}
          >
            {running && <Loader2 className="w-4 h-4 animate-spin" />}
            {isDelete
              ? running ? '删除中…' : `彻底删除 ${pickedCount} 个批次`
              : running ? '回滚中…' : `确认回滚 ${pickedCount} 个批次`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BatchConfirmDialog;
