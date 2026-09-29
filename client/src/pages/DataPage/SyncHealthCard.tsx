/**
 * 设备与同步健康卡
 * 展示已握手设备的环境信息（机型/系统/App 版本/能力）+ 最近同步事件流水 + 失败统计，
 * 让「App 传不过来」这类问题一屏定位：哪台设备、什么版本、卡在哪一步、服务端拒了什么。
 */
import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Smartphone, RefreshCw, Loader2, AlertTriangle, CheckCircle2, Radio } from 'lucide-react';

import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { getSyncHealth } from '@client/src/api/sync';
import type { SyncHealthResponse, DeviceInfoItem } from '@shared/api.interface';

const KIND_LABEL: Record<string, string> = {
  contacts: '联系人',
  messages: '短信',
  calls: '通话',
};

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : format(d, 'MM-dd HH:mm');
};

const SyncHealthCard: React.FC = () => {
  const [data, setData] = useState<SyncHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSyncHealth();
      setData(res);
    } catch {
      toast.error('获取同步健康失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const deviceLabel = (d: DeviceInfoItem) =>
    [d.osName, d.osVersion, d.deviceBrand, d.deviceModel].filter(Boolean).join(' ') || '未知设备';

  const hasError = (data?.stats.failedCommits ?? 0) > 0;

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Radio className="w-4 h-4 text-slate-500" strokeWidth={1.5} />
            设备与同步健康
            {data && data.devices.length > 0 && (
              <span className="text-xs font-normal text-slate-400">
                {data.devices.length} 台设备 · {data.stats.totalEvents} 次同步
              </span>
            )}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            App 启动时通过「握手」上报环境与能力，云端下发限制与规范——「传不过来」时先看这里
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && (hasError ? (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 gap-1">
              <AlertTriangle className="w-3 h-3" />
              近 30 天 {data.stats.failedCommits} 次同步有失败
            </Badge>
          ) : data && data.stats.totalEvents > 0 ? (
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1">
              <CheckCircle2 className="w-3 h-3" />
              同步正常
            </Badge>
          ) : null)}
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" strokeWidth={1.5} />}
            刷新
          </Button>
        </div>
      </div>

      {data && data.stats.lastErrorMessage && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          最近失败（{data.stats.lastErrorAt ? fmtTime(data.stats.lastErrorAt) : '-'}）：{data.stats.lastErrorMessage}
        </div>
      )}

      {/* 设备列表 */}
      {data && data.devices.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {data.devices.map((d) => (
            <div key={d.deviceId} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <Smartphone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{deviceLabel(d)}</span>
                <span className="ml-auto text-slate-400 shrink-0">{fmtTime(d.lastSeenAt)}</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-400 flex flex-wrap gap-x-3">
                <span>App {d.appVersion || '?'}</span>
                <span>握手 {d.handshakeCount} 次</span>
                {d.capabilities.length > 0 && <span>能力：{d.capabilities.join('、')}</span>}
              </div>
              <div className="mt-1 text-[10px] text-slate-300 truncate">ID {d.deviceId}</div>
            </div>
          ))}
        </div>
      )}

      {/* 最近事件（默认折叠，点击展开） */}
      {data && data.recentEvents.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-slate-700"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '收起' : `展开`}最近同步流水（{data.recentEvents.length} 条）
          </button>
          {expanded && (
            <div className="mt-2 max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
              {data.recentEvents.map((e) => {
                const failed = Number((e.summary as { failed?: number }).failed ?? 0) > 0;
                const isStart = e.action === 'sync_start';
                return (
                  <div key={e.id} className="px-3 py-2 flex items-center gap-2 text-xs min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${failed ? 'bg-amber-500' : isStart ? 'bg-slate-300' : 'bg-emerald-500'}`} />
                    <span className="text-slate-400 shrink-0">{fmtTime(e.createdAt)}</span>
                    <span className="font-medium text-slate-700 shrink-0">
                      {isStart ? '开始' : '写入'}
                      {e.kind ? `·${KIND_LABEL[e.kind] ?? e.kind}` : ''}
                    </span>
                    <span className="text-slate-500 truncate">
                      {isStart
                        ? `预估 ${(e.summary as { total?: number }).total ?? 0} 条`
                        : `成功 ${Number((e.summary as { created?: number }).created ?? 0)} / 跳过 ${Number((e.summary as { skipped?: number }).skipped ?? 0)} / 失败 ${Number((e.summary as { failed?: number }).failed ?? 0)}`}
                    </span>
                    {failed && (
                      <span className="text-amber-700 truncate">
                        {(e.summary as { errorTop?: string[] }).errorTop?.[0]}
                      </span>
                    )}
                    {e.deviceInfo && (
                      <span className="ml-auto text-slate-300 truncate max-w-[140px] shrink-0">{e.deviceInfo}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {data && data.devices.length === 0 && data.stats.totalEvents === 0 && (
        <div className="mt-3 rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
          还没有设备握手记录。App 升级到对接 v2.7.3 后，启动时会自动上报环境（机型/系统/版本/能力），
          这里就能看到每台设备的同步健康状态。
        </div>
      )}
    </section>
  );
};

export default SyncHealthCard;
