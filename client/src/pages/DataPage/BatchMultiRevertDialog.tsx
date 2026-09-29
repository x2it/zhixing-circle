/**
 * 批量回滚弹窗（时光机多选/全选）
 * 自包含：内部管理选中态；走服务端 revert-multi 逐批次独立回滚，
 * 单个失败不影响其余，完成后汇总报告（清除多少人、保留多少人）。
 * 回滚策略与单条一致：仅删除未被后续跟进/修改过的联系人（保守回滚）。
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
import { revertBatchesMulti } from '@client/src/api/batches';
import type { ImportBatch } from '@shared/api.interface';

const BatchMultiRevertDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batches: ImportBatch[];
  onDone: () => void;
}> = ({ open, onOpenChange, batches, onDone }) => {
  const revertable = useMemo(
    () => batches.filter((b: ImportBatch) => b.status !== 'reverted'),
    [batches],
  );
  const [picked, setPicked] = useState<string[]>([]);
  const [running, setRunning] = useState<boolean>(false);

  const pickedContacts = revertable
    .filter((b: ImportBatch) => picked.includes(b.id))
    .reduce((s: number, b: ImportBatch) => s + (b.contactCount ?? 0), 0);

  const handleRun = async () => {
    if (picked.length === 0 || running) return;
    setRunning(true);
    try {
      const res = await revertBatchesMulti(picked);
      const failed = res.results.filter(r => !r.success);
      if (failed.length === 0) {
        toast.success(
          `已批量回滚 ${res.results.length} 个批次：清除 ${res.totalDeleted} 个联系人，保留 ${res.totalKept} 个已被修改的`,
        );
      } else {
        toast.warning(
          `回滚完成：成功 ${res.results.length - failed.length} 个（清除 ${res.totalDeleted} 人），失败 ${failed.length} 个（${failed[0]?.error ?? '未知原因'}）`,
        );
      }
      setPicked([]);
      onOpenChange(false);
      onDone();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : '未知错误';
      toast.error(`批量回滚失败：${msg}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o: boolean) => {
        if (running) return;
        if (!o) setPicked([]);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" strokeWidth={1.5} />
            批量回滚
          </DialogTitle>
          <DialogDescription>
            与单条回滚相同的保守策略：仅删除未被后续跟进/修改过的联系人，被动过的自动保留。逐批次独立执行，单个失败不影响其余。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">
              已选 <span className="font-semibold text-slate-900">{picked.length}</span> / {revertable.length} 个批次 · 约 {pickedContacts} 人
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                className="px-2 py-0.5 rounded hover:bg-slate-100 text-slate-600"
                onClick={() => setPicked(revertable.map((b: ImportBatch) => b.id))}
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
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
            {revertable.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-6">没有可回滚的批次（已回滚的批次不再列出）</p>
            )}
            {revertable.map((b: ImportBatch) => {
              const checked = picked.includes(b.id);
              return (
                <label
                  key={b.id}
                  className={`flex items-center gap-2 px-3 py-2 text-xs cursor-pointer transition-colors ${
                    checked ? 'bg-amber-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-amber-600"
                    checked={checked}
                    onChange={(e) =>
                      setPicked(prev =>
                        e.target.checked ? [...prev, b.id] : prev.filter(x => x !== b.id),
                      )
                    }
                  />
                  <span className={`flex-1 truncate ${checked ? 'font-medium text-amber-900' : 'text-slate-700'}`}>
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
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={running}
            onClick={() => {
              setPicked([]);
              onOpenChange(false);
            }}
          >
            取消
          </Button>
          <Button
            className="bg-amber-600 hover:bg-amber-700 text-white"
            disabled={picked.length === 0 || running}
            onClick={() => void handleRun()}
          >
            {running && <Loader2 className="w-4 h-4 animate-spin" />}
            回滚 {picked.length} 个批次
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BatchMultiRevertDialog;
