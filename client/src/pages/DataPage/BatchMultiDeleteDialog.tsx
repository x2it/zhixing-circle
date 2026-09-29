/**
 * 批量删除弹窗（时光机多选/全选）
 *
 * 与「批量回滚」对称但语义完全不同：
 * - 回滚 = 保守撤销，被跟进过的联系人会保留
 * - 删除 = 彻底清理，连同该批次下的联系人、跟进、标签关联一并移除且不可恢复
 *
 * 因此这里强制二次确认（输入 DELETE），避免与回滚按钮混淆导致误删。
 * 执行走服务端 removeMulti，逐批次独立执行，单个失败不影响其余。
 */
import React, { useMemo, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
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
import { removeBatchesMulti } from '@client/src/api/batches';
import type { ImportBatch } from '@shared/api.interface';

const CONFIRM_TEXT = 'DELETE';

const BatchMultiDeleteDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batches: ImportBatch[];
  onDone: () => void;
}> = ({ open, onOpenChange, batches, onDone }) => {
  // 已回滚的批次里联系人已被清理，仍列出以便彻底删除批次记录本身
  const deletable = useMemo(() => batches, [batches]);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string>('');
  const [running, setRunning] = useState<boolean>(false);

  const pickedContacts = deletable
    .filter((b: ImportBatch) => picked.includes(b.id))
    .reduce((s: number, b: ImportBatch) => s + (b.contactCount ?? 0), 0);

  const reset = () => {
    setPicked([]);
    setConfirm('');
  };

  const handleRun = async () => {
    if (picked.length === 0 || running) return;
    if (confirm.trim() !== CONFIRM_TEXT) return;
    setRunning(true);
    try {
      const res = await removeBatchesMulti(picked);
      const failed = res.results.filter(r => !r.success);
      if (failed.length === 0) {
        toast.success(
          `已彻底删除 ${res.results.length} 个批次，清除 ${res.totalDeletedContacts} 个联系人`,
        );
      } else {
        toast.warning(
          `删除完成：成功 ${res.results.length - failed.length} 个（清除 ${res.totalDeletedContacts} 人），失败 ${failed.length} 个（${failed[0]?.error ?? '未知原因'}）`,
        );
      }
      reset();
      onOpenChange(false);
      onDone();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : '未知错误';
      toast.error(`批量删除失败：${msg}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o: boolean) => {
        if (running) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" strokeWidth={1.5} />
            批量删除批次
          </DialogTitle>
          <DialogDescription>
            与回滚不同，这是<span className="font-medium text-red-600">不可恢复</span>的彻底清理：
            批次记录连同其名下的联系人、跟进记录、标签关联一并删除。逐批次独立执行，单个失败不影响其余。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">
              已选 <span className="font-semibold text-slate-900">{picked.length}</span> / {deletable.length} 个批次 · 约 {pickedContacts} 人
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                className="px-2 py-0.5 rounded hover:bg-slate-100 text-slate-600"
                onClick={() => setPicked(deletable.map((b: ImportBatch) => b.id))}
              >
                全选
              </button>
              <button
                type="button"
                className="px-2 py-0.5 rounded hover:bg-slate-100 text-slate-600"
                onClick={() => setPicked([])}
              >
                清空
              </button>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
            {deletable.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-6">暂无可删除的批次</p>
            )}
            {deletable.map((b: ImportBatch) => {
              const checked = picked.includes(b.id);
              return (
                <label
                  key={b.id}
                  className={`flex items-center gap-2 px-3 py-2 text-xs cursor-pointer transition-colors ${
                    checked ? 'bg-red-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-red-600"
                    checked={checked}
                    onChange={(e) =>
                      setPicked(prev =>
                        e.target.checked ? [...prev, b.id] : prev.filter(x => x !== b.id),
                      )
                    }
                  />
                  <span className={`flex-1 truncate ${checked ? 'font-medium text-red-900' : 'text-slate-700'}`}>
                    {b.name}
                  </span>
                  <span className="text-slate-400">{b.contactCount} 人</span>
                  {b.deviceInfo && (
                    <span className="text-slate-300 truncate max-w-[110px]">{b.deviceInfo}</span>
                  )}
                </label>
              );
            })}
          </div>

          <div className="space-y-1 pt-1">
            <label className="text-xs text-slate-500">
              确认请输入 <span className="font-mono font-semibold text-red-600">{CONFIRM_TEXT}</span>
            </label>
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={CONFIRM_TEXT}
              className="w-full h-8 px-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-red-400 font-mono"
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={running}
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            取消
          </Button>
          <Button
            className="bg-red-600 hover:bg-red-700 text-white"
            disabled={picked.length === 0 || running || confirm.trim() !== CONFIRM_TEXT}
            onClick={() => void handleRun()}
          >
            {running && <Loader2 className="w-4 h-4 animate-spin" />}
            彻底删除 {picked.length} 个批次
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BatchMultiDeleteDialog;
