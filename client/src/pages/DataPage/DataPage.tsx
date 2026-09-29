import React, { useState, useRef, useEffect } from 'react';
import { GitMerge, ChevronRight } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  Download,
  FileSpreadsheet,
  Upload,
  Trash2,
  AlertTriangle,
  HardDrive,
  Layers,
  FileJson,
  Sparkles,
  ArrowRight,
  Undo2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';

import { Button } from '@client/src/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@client/src/components/ui/card';
import { Input } from '@client/src/components/ui/input';
import { Label } from '@client/src/components/ui/label';
import { Switch } from '@client/src/components/ui/switch';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@client/src/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@client/src/components/ui/radio-group';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@client/src/components/ui/alert-dialog';

import {
  exportAllData,
  importAllData,
  exportContactsCsv,
  clearAllData,
  importXlsx,
  seedExamples,
  getMergeLogs,
} from '@client/src/api/data';
import type { MergeLog } from '@shared/api.interface';
import GovernancePanel from './GovernancePanel';
import SyncHealthCard from './SyncHealthCard';
import * as batchesApi from '@client/src/api/batches';
import BatchMultiRevertDialog from './BatchMultiRevertDialog';
import type {
  ExportData,
  ImportBatch,
  ImportMode,
  DuplicateStrategy,
  XlsxImportResponse,
  BatchDiffResponse,
} from '@shared/api.interface';

type ExportFormat = 'json' | 'xlsx' | 'csv';
type ExportScope = 'all' | 'batch';

const XLSX_TARGET_FIELDS: Array<{ value: string; label: string }> = [
  { value: 'name', label: '姓名' },
  { value: 'phone', label: '手机号' },
  { value: 'wechat', label: '微信' },
  { value: 'source', label: '来源' },
  { value: 'area', label: '意向区域' },
  { value: 'budget', label: '预算' },
  { value: 'houseType', label: '房型' },
  { value: 'tier', label: '意向等级' },
  { value: 'memo', label: '备注' },
  { value: 'nextFollowupDate', label: '下次跟进时间' },
  { value: 'ignore', label: '忽略' },
];

// 模糊匹配：列名 → 目标字段推荐
function suggestTarget(column: string): string {
  const s = column.toLowerCase().trim();
  const map: Array<{ keys: string[]; target: string }> = [
    { keys: ['姓名', '名字', 'name', '客户名'], target: 'name' },
    { keys: ['手机', '电话', 'phone', 'mobile', 'tel', '联系电话'], target: 'phone' },
    { keys: ['微信', 'wechat', 'wx', '微信号'], target: 'wechat' },
    { keys: ['来源', 'source', '渠道', '获客'], target: 'source' },
    { keys: ['区域', '意向区域', 'area', '地区', '地段'], target: 'area' },
    { keys: ['预算', '总价', 'budget', '价格'], target: 'budget' },
    { keys: ['房型', '户型', 'house', '室'], target: 'houseType' },
    { keys: ['等级', '层级', 'tier', '意向等级', '分级', 'a级', 's级'], target: 'tier' },
    { keys: ['备注', 'memo', 'remark', '说明', 'note'], target: 'memo' },
    { keys: ['下次跟进', '跟进时间', 'next', 'followup', '回访时间'], target: 'nextFollowupDate' },
  ];
  for (const { keys, target } of map) {
    if (keys.some((k) => s.includes(k.toLowerCase()))) return target;
  }
  return 'ignore';
}

const DataPage: React.FC = () => {
  const navigate = useNavigate();

  // 通用
  const [clearing, setClearing] = useState<boolean>(false);
  const [clearConfirmText, setClearConfirmText] = useState<string>('');
  const [clearDialogOpen, setClearDialogOpen] = useState<boolean>(false);

  // 导出
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('json');
  const [exportScope, setExportScope] = useState<ExportScope>('all');
  const [exportBatchId, setExportBatchId] = useState<string>('');
  const [exportIncludeArchived, setExportIncludeArchived] = useState<boolean>(false);

  // JSON 导入
  const [importingJson, setImportingJson] = useState<boolean>(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // XLSX 导入
  const [xlsxFile, setXlsxFile] = useState<File | null>(null);
  const [xlsxColumns, setXlsxColumns] = useState<string[]>([]);
  const [xlsxRows, setXlsxRows] = useState<Array<Record<string, string>>>([]);
  const [xlsxPreviewRows, setXlsxPreviewRows] = useState<Array<Record<string, string>>>([]);
  const [xlsxMapping, setXlsxMapping] = useState<Record<string, string>>({});
  const [xlsxBatchName, setXlsxBatchName] = useState<string>(`导入 ${new Date().toISOString().slice(0, 10)}`);
  const [xlsxMode, setXlsxMode] = useState<ImportMode>('append');
  const [xlsxDupStrategy, setXlsxDupStrategy] = useState<DuplicateStrategy>('skip');
  const [xlsxImporting, setXlsxImporting] = useState<boolean>(false);
  const [xlsxImportResult, setXlsxImportResult] = useState<XlsxImportResponse | null>(null);
  const xlsxFileInputRef = useRef<HTMLInputElement>(null);

  // 生成示例数据
  const [seeding, setSeeding] = useState<boolean>(false);

  // Batches
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState<boolean>(false);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState<boolean>(false);
  const [batchToDelete, setBatchToDelete] = useState<ImportBatch | null>(null);
  // 时光机（回滚）
  const [revertDialogOpen, setRevertDialogOpen] = useState<boolean>(false);
  const [batchToRevert, setBatchToRevert] = useState<ImportBatch | null>(null);
  const [revertDiff, setRevertDiff] = useState<BatchDiffResponse | null>(null);
  const [revertLoading, setRevertLoading] = useState<boolean>(false);
  const [reverting, setReverting] = useState<boolean>(false);
  // 时光机批量回滚（多选/全选）
  const [multiRevertOpen, setMultiRevertOpen] = useState<boolean>(false);

  // Merge logs
  const [mergeLogs, setMergeLogs] = useState<MergeLog[]>([]);
  const [mergeLogsLoading, setMergeLogsLoading] = useState<boolean>(false);
  const [mergeLogsLoaded, setMergeLogsLoaded] = useState<boolean>(false);

  useEffect(() => {
    void loadBatches();
  }, []);

  const loadBatches = async (): Promise<void> => {
    try {
      setBatchesLoading(true);
      const data = await batchesApi.getBatches();
      setBatches(data);
    } catch (error) {
      logger.error('加载批次列表失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`加载批次列表失败：${msg}`);
    } finally {
      setBatchesLoading(false);
    }
  };

  const loadMergeLogs = async (): Promise<void> => {
    try {
      setMergeLogsLoading(true);
      const data = await getMergeLogs({ pageSize: 50 });
      setMergeLogs(data.items);
      setMergeLogsLoaded(true);
    } catch (error) {
      logger.error('加载合并记录失败', error);
    } finally {
      setMergeLogsLoading(false);
    }
  };

  const handleDeleteBatch = (batch: ImportBatch): void => {
    setBatchToDelete(batch);
    setDeleteDialogOpen(true);
  };

  /** 回滚：先拉预览，让用户看到会发生什么 */
  const handleRevertBatch = async (batch: ImportBatch): Promise<void> => {
    try {
      setRevertLoading(true);
      const diff = await batchesApi.getBatchDiff(batch.id);
      setRevertDiff(diff);
      setBatchToRevert(batch);
      setRevertDialogOpen(true);
    } catch (error) {
      logger.error('获取回滚预览失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`无法获取回滚预览：${msg}`);
    } finally {
      setRevertLoading(false);
    }
  };

  const confirmRevertBatch = async (): Promise<void> => {
    if (!batchToRevert) return;
    setReverting(true);
    try {
      const result = await batchesApi.revertBatch(batchToRevert.id);
      toast.success(
        `已回滚「${batchToRevert.name}」：删除 ${result.deleted} 条，保留 ${result.kept} 条`
      );
      await loadBatches();
      setRevertDialogOpen(false);
      setBatchToRevert(null);
      setRevertDiff(null);
    } catch (error) {
      logger.error('回滚批次失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`回滚失败：${msg}`);
    } finally {
      setReverting(false);
    }
  };

  const confirmDeleteBatch = async (): Promise<void> => {
    if (!batchToDelete) return;
    setDeletingBatchId(batchToDelete.id);
    try {
      const result = await batchesApi.deleteBatch(batchToDelete.id);
      toast.success(
        `已删除批次 ${batchToDelete.name}，共删除 ${result.deletedContacts} 个联系人`
      );
      setBatches((prev: ImportBatch[]) =>
        prev.filter((b: ImportBatch) => b.id !== batchToDelete.id)
      );
      setDeleteDialogOpen(false);
      setBatchToDelete(null);
    } catch (error) {
      logger.error('删除批次失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`删除批次失败：${msg}`);
    } finally {
      setDeletingBatchId(null);
    }
  };

  const triggerDownload = (content: BlobPart, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const buildExportParams = (): { batchId?: string; includeArchived?: boolean } => {
    const params: { batchId?: string; includeArchived?: boolean } = {};
    if (exportScope === 'batch' && exportBatchId) {
      params.batchId = exportBatchId;
    }
    if (exportIncludeArchived) {
      params.includeArchived = true;
    }
    return params;
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = buildExportParams();
      const dateStr = new Date().toISOString().slice(0, 10);

      if (exportFormat === 'json') {
        const data: ExportData = await exportAllData(params);
        const jsonStr = JSON.stringify(data, null, 2);
        triggerDownload(jsonStr, `contacts-backup-${dateStr}.json`, 'application/json');
        toast.success('JSON 备份文件已生成');
      } else if (exportFormat === 'csv') {
        const csvContent = await exportContactsCsv(params);
        triggerDownload(csvContent, `contacts-${dateStr}.csv`, 'text/csv;charset=utf-8');
        toast.success('CSV 文件已生成');
      } else if (exportFormat === 'xlsx') {
        // 前端用 JSON 接口拉数据，再用 xlsx 生成 workbook
        const data: ExportData = await exportAllData(params);
        const contacts = data.contacts || [];
        const rows = contacts.map((c) => ({
          姓名: c.name || '',
          手机号: c.phone || '',
          微信: c.wechat || '',
          层级: c.tier || '',
          备忘: c.memo || '',
          标签: (c.tags || []).map((t) => t.name).join(';'),
          下次跟进时间: c.nextFollowupDate || '',
          跟进备注: c.followupNote || '',
          归档: c.archived ? '是' : '否',
          创建时间: c.createdAt || '',
        }));
        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '联系人');
        XLSX.writeFile(workbook, `contacts-${dateStr}.xlsx`);
        toast.success('XLSX 文件已生成');
      }
    } catch (error) {
      logger.error('导出失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`导出失败：${msg}`);
    } finally {
      setExporting(false);
    }
  };

  // --- JSON 导入 ---
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
    }
  };

  const handleImportJson = async () => {
    if (!importFile) {
      toast.error('请先选择 JSON 文件');
      return;
    }
    setImportingJson(true);
    try {
      const text = await importFile.text();
      const data: ExportData = JSON.parse(text);
      if (!data.contacts || !data.tags || !data.followups) {
        throw new Error('文件格式不正确');
      }
      const result = await importAllData(data);
      toast.success(
        `导入成功：${result.importedContacts} 联系人 / ${result.importedTags} 标签 / ${result.importedFollowups} 跟进记录`
      );
      setImportFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      void loadBatches();
    } catch (error) {
      logger.error('导入失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`导入失败：${msg}`);
    } finally {
      setImportingJson(false);
    }
  };

  // --- XLSX 导入 ---
  const handleXlsxFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setXlsxFile(file);
    setXlsxImportResult(null);
    parseXlsxFile(file);
  };

  const parseXlsxFile = async (file: File): Promise<void> => {
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(worksheet, {
        defval: '',
      });

      if (rows.length === 0) {
        toast.error('Excel 文件中没有数据');
        return;
      }

      const columns = Object.keys(rows[0]);
      setXlsxColumns(columns);
      setXlsxRows(rows);
      setXlsxPreviewRows(rows.slice(0, 5));

      // 自动推荐映射
      const mapping: Record<string, string> = {};
      for (const col of columns) {
        mapping[col] = suggestTarget(col);
      }
      setXlsxMapping(mapping);

      // 自动填充批次名
      const baseName = file.name.replace(/\.(xlsx|xls)$/i, '');
      setXlsxBatchName(baseName || `导入 ${new Date().toISOString().slice(0, 10)}`);

      toast.success(`解析成功，共 ${rows.length} 条数据，${columns.length} 列`);
    } catch (error) {
      logger.error('解析 Excel 失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`解析失败：${msg}`);
    }
  };

  const handleMappingChange = (column: string, target: string) => {
    setXlsxMapping((prev) => ({ ...prev, [column]: target }));
  };

  const handleImportXlsx = async () => {
    if (xlsxRows.length === 0) {
      toast.error('请先选择 Excel 文件');
      return;
    }
    if (!xlsxBatchName.trim()) {
      toast.error('请输入批次名称');
      return;
    }

    // 把原始 rows 按映射转换为字段名对象
    const mappedRows = xlsxRows.map((row) => {
      const result: Record<string, string> = {};
      for (const col of xlsxColumns) {
        const target = xlsxMapping[col];
        if (target && target !== 'ignore') {
          result[target] = row[col] ?? '';
        }
      }
      return result;
    });

    setXlsxImporting(true);
    try {
      const result = await importXlsx({
        batchName: xlsxBatchName.trim(),
        mode: xlsxMode,
        duplicateStrategy: xlsxDupStrategy,
        rows: mappedRows,
      });
      setXlsxImportResult(result);
      if (result.success) {
        toast.success(
          `导入完成：成功 ${result.imported} / 跳过 ${result.skipped} / 失败 ${result.failed}`
        );
        void loadBatches();
      } else {
        toast.error('导入失败，请检查错误信息');
      }
    } catch (error) {
      logger.error('XLSX 导入失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`导入失败：${msg}`);
    } finally {
      setXlsxImporting(false);
    }
  };

  const resetXlsxImport = () => {
    setXlsxFile(null);
    setXlsxColumns([]);
    setXlsxRows([]);
    setXlsxPreviewRows([]);
    setXlsxMapping({});
    setXlsxImportResult(null);
    if (xlsxFileInputRef.current) {
      xlsxFileInputRef.current.value = '';
    }
  };

  // --- 生成示例数据 ---
  const handleSeedExamples = async () => {
    setSeeding(true);
    try {
      const result = await seedExamples();
      toast.success(`已生成 ${result.created} 个示例联系人`);
      navigate('/contacts');
    } catch (error) {
      logger.error('生成示例数据失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`生成失败：${msg}`);
    } finally {
      setSeeding(false);
    }
  };

  // --- 清空 ---
  const handleClearData = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    if (clearConfirmText !== '确认清空') {
      toast.error('请输入"确认清空"以继续');
      return;
    }
    setClearing(true);
    try {
      const result = await clearAllData();
      toast.success(
        `已清空：${result.cleared.contacts} 联系人 / ${result.cleared.tags} 标签 / ${result.cleared.followups} 跟进记录 / ${result.cleared.batches} 批次 / ${result.cleared.messages} 短信`
      );
      setClearConfirmText('');
      setClearDialogOpen(false);
      void loadBatches();
    } catch (error) {
      logger.error('清空数据失败', error);
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '未知错误';
      toast.error(`清空失败：${msg}`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">数据管理</h2>
        <p className="text-sm text-slate-600 mt-1">
          数据导入导出与备份
        </p>
      </div>

      {/* 区块 0：设备与同步健康（App 环境握手 + 同步事件流水） */}
      <div className="space-y-5 max-w-3xl">
        <SyncHealthCard />
      </div>

      {/* 区块 0：数据治理（批次合并 / 智能清洗 / 重复检测合并） */}
      <div className="space-y-5 max-w-3xl">
        <GovernancePanel batches={batches} onBatchesChanged={() => void loadBatches()} />
      </div>

      <div className="space-y-5 max-w-3xl">
        {/* 区块 1：数据导出 */}
        <Card className="border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200">
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0">
                <Download className="w-5 h-5" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg font-semibold">
                  导出数据
                </CardTitle>
                <CardDescription className="text-sm text-slate-500 mt-1">
                  支持 JSON 备份、XLSX 表格、CSV 三种格式
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 导出范围 */}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">导出范围</Label>
              <RadioGroup
                value={exportScope}
                onValueChange={(v: string) => setExportScope(v as ExportScope)}
                className="flex flex-row gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="all" id="export-all" />
                  <Label htmlFor="export-all" className="text-sm font-normal cursor-pointer">
                    全部批次
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="batch" id="export-batch" />
                  <Label htmlFor="export-batch" className="text-sm font-normal cursor-pointer">
                    指定批次
                  </Label>
                </div>
              </RadioGroup>
              {exportScope === 'batch' && (
                <Select
                  value={exportBatchId}
                  onValueChange={setExportBatchId}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择批次" />
                  </SelectTrigger>
                  <SelectContent>
                    {batches.map((b: ImportBatch) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}（{b.contactCount} 条）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* 包含归档 */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-foreground">包含归档联系人</Label>
                <p className="text-xs text-muted-foreground">默认仅导出活跃联系人</p>
              </div>
              <Switch
                checked={exportIncludeArchived}
                onCheckedChange={setExportIncludeArchived}
              />
            </div>

            {/* 格式选择 */}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">导出格式</Label>
              <Tabs
                value={exportFormat}
                onValueChange={(v: string) => setExportFormat(v as ExportFormat)}
              >
                <TabsList className="w-full grid grid-cols-3">
                  <TabsTrigger value="json" className="flex items-center gap-1.5">
                    <FileJson className="w-4 h-4" strokeWidth={1.5} />
                    JSON 备份
                  </TabsTrigger>
                  <TabsTrigger value="xlsx" className="flex items-center gap-1.5">
                    <FileSpreadsheet className="w-4 h-4" strokeWidth={1.5} />
                    XLSX
                  </TabsTrigger>
                  <TabsTrigger value="csv" className="flex items-center gap-1.5">
                    <HardDrive className="w-4 h-4" strokeWidth={1.5} />
                    CSV
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <Button
              className="w-full bg-amber-600 hover:bg-amber-700 text-white border-amber-600"
              onClick={handleExport}
              disabled={exporting || (exportScope === 'batch' && !exportBatchId)}
            >
              <Download className="w-4 h-4" strokeWidth={1.5} />
              {exporting ? '导出中...' : '开始导出'}
            </Button>
          </CardContent>
        </Card>

        {/* 区块 2：导入批次（时光机） */}
        <Card className="border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200">
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-50 text-slate-600 flex items-center justify-center flex-shrink-0">
                <Layers className="w-5 h-5" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg font-semibold">
                  数据时光机
                </CardTitle>
                <CardDescription className="text-sm text-slate-500 mt-1">
                  每一次同步/导入都是一个独立批次，可追溯来源、可安全回滚。回滚采用保守策略：已被后续跟进的联系人会保留
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-400">共 {batches.length} 个批次</span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={batches.filter(b => b.status !== 'reverted').length === 0}
                onClick={() => setMultiRevertOpen(true)}
              >
                批量回滚…
              </Button>
            </div>
            {batchesLoading ? (
              <p className="text-sm text-slate-400 py-4 text-center">加载中...</p>
            ) : batches.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">暂无操作批次</p>
            ) : (
              <div className="space-y-2">
                {batches.map((batch: ImportBatch) => {
                  const isReverted = batch.status === 'reverted';
                  const channelLabel: Record<string, string> = {
                    app_sync: 'App 同步',
                    excel_import: 'Excel 导入',
                    json_import: 'JSON 导入',
                    web_manual: '网页操作',
                    seed: '示例数据',
                  };
                  return (
                    <div
                      key={batch.id}
                      className={`flex items-center justify-between py-2.5 px-3 rounded-md border transition-colors ${
                        isReverted
                          ? 'border-slate-200 bg-slate-50/70 opacity-70'
                          : 'border-border hover:bg-slate-50/50'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground truncate">
                            {batch.name}
                          </p>
                          {isReverted ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 flex-shrink-0">
                              已回滚
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 flex-shrink-0">
                              {channelLabel[batch.channel ?? ''] ?? batch.channel ?? '未知来源'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {batch.contactCount} 个联系人 · {batch.createdAt.slice(0, 16).replace('T', ' ')}
                          {batch.deviceInfo ? ` · ${batch.deviceInfo}` : ''}
                        </p>
                        {(batch.contactSkipped ?? 0) > 0 && (
                          <p className="text-xs text-amber-600 mt-0.5">
                            幂等跳过 {batch.contactSkipped} 条
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!isReverted && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-slate-500 hover:text-amber-600 hover:bg-amber-50"
                            onClick={() => handleRevertBatch(batch)}
                            title="回滚该批次"
                          >
                            <Undo2 className="w-4 h-4" strokeWidth={1.5} />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-slate-500 hover:text-red-600 hover:bg-red-50"
                          onClick={() => handleDeleteBatch(batch)}
                          title="彻底删除该批次"
                        >
                          <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 区块 3：数据导入 */}
        <Card className="border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200">
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                <Upload className="w-5 h-5" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg font-semibold">
                  导入数据
                </CardTitle>
                <CardDescription className="text-sm text-slate-500 mt-1">
                  支持 JSON 备份恢复和 Excel 表格导入
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs defaultValue="xlsx">
              <TabsList className="w-full grid grid-cols-2">
                <TabsTrigger value="xlsx" className="flex items-center gap-1.5">
                  <FileSpreadsheet className="w-4 h-4" strokeWidth={1.5} />
                  XLSX 导入
                </TabsTrigger>
                <TabsTrigger value="json" className="flex items-center gap-1.5">
                  <FileJson className="w-4 h-4" strokeWidth={1.5} />
                  JSON 导入
                </TabsTrigger>
              </TabsList>

              {/* XLSX 导入 */}
              <TabsContent value="xlsx" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="xlsx-file">选择 Excel 文件</Label>
                  <Input
                    ref={xlsxFileInputRef}
                    id="xlsx-file"
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleXlsxFileSelect}
                  />
                  {xlsxFile && (
                    <p className="text-xs text-slate-500">
                      已选择：{xlsxFile.name} (
                      {(xlsxFile.size / 1024).toFixed(1)} KB) ·{' '}
                      共 {xlsxRows.length} 条数据
                    </p>
                  )}
                </div>

                {xlsxColumns.length > 0 && (
                  <>
                    {/* 预览 */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">数据预览（前 5 行）</Label>
                      </div>
                      <div className="border border-border rounded-md overflow-x-auto max-h-48 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 sticky top-0">
                            <tr>
                              {xlsxColumns.map((col) => (
                                <th
                                  key={col}
                                  className="px-2 py-1.5 text-left font-medium text-slate-600 border-b border-border whitespace-nowrap"
                                >
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {xlsxPreviewRows.map((row, i) => (
                              <tr key={i} className="border-b border-border last:border-0">
                                {xlsxColumns.map((col) => (
                                  <td
                                    key={col}
                                    className="px-2 py-1.5 text-slate-700 whitespace-nowrap"
                                  >
                                    {row[col] || ''}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* 字段映射 */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">字段映射</Label>
                        <span className="text-xs text-muted-foreground">
                          系统已自动推荐，可手动调整
                        </span>
                      </div>
                      <div className="border border-border rounded-md divide-y divide-border">
                        {xlsxColumns.map((col) => (
                          <div
                            key={col}
                            className="flex items-center gap-3 px-3 py-2"
                          >
                            <span className="flex-1 min-w-0 text-sm truncate">{col}</span>
                            <ArrowRight className="w-4 h-4 text-slate-300 flex-shrink-0" strokeWidth={1.5} />
                            <div className="w-36 flex-shrink-0">
                              <Select
                                value={xlsxMapping[col] || 'ignore'}
                                onValueChange={(v: string) => handleMappingChange(col, v)}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {XLSX_TARGET_FIELDS.map((f) => (
                                    <SelectItem key={f.value} value={f.value} className="text-xs">
                                      {f.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 导入设置 */}
                    <div className="space-y-3">
                      <Label className="text-sm font-medium">导入设置</Label>

                      <div className="space-y-1.5">
                        <Label htmlFor="xlsx-batch-name" className="text-xs text-muted-foreground">
                          批次名称
                        </Label>
                        <Input
                          id="xlsx-batch-name"
                          value={xlsxBatchName}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setXlsxBatchName(e.target.value)
                          }
                          placeholder="输入批次名称"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">导入方式</Label>
                          <RadioGroup
                            value={xlsxMode}
                            onValueChange={(v: string) => setXlsxMode(v as ImportMode)}
                            className="flex flex-row gap-3"
                          >
                            <div className="flex items-center gap-1.5">
                              <RadioGroupItem value="append" id="xlsx-append" />
                              <Label htmlFor="xlsx-append" className="text-xs font-normal cursor-pointer">
                                追加
                              </Label>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <RadioGroupItem value="overwrite" id="xlsx-overwrite" />
                              <Label htmlFor="xlsx-overwrite" className="text-xs font-normal cursor-pointer">
                                覆盖
                              </Label>
                            </div>
                          </RadioGroup>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">重复处理（按手机号）</Label>
                          <RadioGroup
                            value={xlsxDupStrategy}
                            onValueChange={(v: string) => setXlsxDupStrategy(v as DuplicateStrategy)}
                            className="flex flex-row gap-3"
                          >
                            <div className="flex items-center gap-1.5">
                              <RadioGroupItem value="skip" id="xlsx-skip" />
                              <Label htmlFor="xlsx-skip" className="text-xs font-normal cursor-pointer">
                                跳过
                              </Label>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <RadioGroupItem value="update" id="xlsx-update" />
                              <Label htmlFor="xlsx-update" className="text-xs font-normal cursor-pointer">
                                更新
                              </Label>
                            </div>
                          </RadioGroup>
                        </div>
                      </div>
                    </div>

                    {/* 导入结果 */}
                    {xlsxImportResult && (
                      <div className={`p-3 rounded-md border ${xlsxImportResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                        <p className="text-sm font-medium mb-2">
                          {xlsxImportResult.success ? '导入完成' : '导入失败'}
                        </p>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <p className="text-lg font-semibold text-green-600">
                              {xlsxImportResult.imported}
                            </p>
                            <p className="text-xs text-muted-foreground">成功</p>
                          </div>
                          <div>
                            <p className="text-lg font-semibold text-amber-600">
                              {xlsxImportResult.skipped}
                            </p>
                            <p className="text-xs text-muted-foreground">跳过</p>
                          </div>
                          <div>
                            <p className="text-lg font-semibold text-red-600">
                              {xlsxImportResult.failed}
                            </p>
                            <p className="text-xs text-muted-foreground">失败</p>
                          </div>
                        </div>
                        {xlsxImportResult.errors && xlsxImportResult.errors.length > 0 && (
                          <div className="mt-2 text-xs text-red-600 space-y-0.5">
                            {xlsxImportResult.errors.slice(0, 3).map((err, i) => (
                              <p key={i}>· {err}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        onClick={resetXlsxImport}
                        disabled={xlsxImporting}
                        className="flex-1"
                      >
                        重新选择
                      </Button>
                      <Button
                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
                        onClick={handleImportXlsx}
                        disabled={xlsxImporting || xlsxRows.length === 0}
                      >
                        <Upload className="w-4 h-4" strokeWidth={1.5} />
                        {xlsxImporting ? '导入中...' : `开始导入（${xlsxRows.length} 条）`}
                      </Button>
                    </div>
                  </>
                )}

                {xlsxColumns.length === 0 && (
                  <p className="text-sm text-slate-400 py-8 text-center border border-dashed border-slate-200 rounded-md">
                    请先选择 .xlsx 文件
                  </p>
                )}
              </TabsContent>

              {/* JSON 导入 */}
              <TabsContent value="json" className="space-y-3 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="import-file">选择 JSON 文件</Label>
                  <Input
                    ref={fileInputRef}
                    id="import-file"
                    type="file"
                    accept=".json,application/json"
                    onChange={handleFileSelect}
                  />
                  {importFile && (
                    <p className="text-xs text-slate-500">
                      已选择：{importFile.name} (
                      {(importFile.size / 1024).toFixed(1)} KB)
                    </p>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  JSON 导入将全量恢复联系人、标签、跟进记录，会覆盖现有数据
                </p>
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
                  onClick={handleImportJson}
                  disabled={!importFile || importingJson}
                >
                  <Upload className="w-4 h-4" strokeWidth={1.5} />
                  {importingJson ? '导入中...' : '导入恢复'}
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* 区块 4：示例数据 */}
        <Card className="border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200">
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg font-semibold">
                  示例数据
                </CardTitle>
                <CardDescription className="text-sm text-slate-500 mt-1">
                  一键生成 18 个示例联系人，快速体验完整功能
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={handleSeedExamples}
              disabled={seeding}
            >
              <Sparkles className="w-4 h-4" strokeWidth={1.5} />
              {seeding ? '生成中...' : '生成示例数据'}
            </Button>
          </CardContent>
        </Card>

        {/* 区块 5：合并记录 */}
        <Card className="border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200">
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-50 text-slate-600 flex items-center justify-center flex-shrink-0">
                <GitMerge className="w-5 h-5" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg font-semibold">
                  合并记录
                </CardTitle>
                <CardDescription className="text-sm text-slate-500 mt-1">
                  查看所有联系人合并操作历史
                </CardDescription>
              </div>
              {!mergeLogsLoaded && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadMergeLogs()}
                  disabled={mergeLogsLoading}
                  className="h-8 text-xs"
                >
                  {mergeLogsLoading ? '加载中...' : '查看记录'}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {mergeLogsLoading && (
              <p className="text-sm text-slate-400 py-4 text-center">加载中...</p>
            )}
            {!mergeLogsLoading && !mergeLogsLoaded && (
              <p className="text-sm text-slate-400 py-4 text-center">点击上方按钮查看合并记录</p>
            )}
            {!mergeLogsLoading && mergeLogsLoaded && mergeLogs.length === 0 && (
              <p className="text-sm text-slate-400 py-4 text-center">暂无合并记录</p>
            )}
            {mergeLogs.length > 0 && (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {mergeLogs.map((log: MergeLog) => (
                  <div
                    key={log.id}
                    className="rounded-md border border-border p-3 bg-white"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <GitMerge className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.5} />
                        <span className="text-xs text-muted-foreground">
                          {new Date(log.createdAt).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground bg-slate-100 px-1.5 py-0.5 rounded">
                        {log.similarityType}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-foreground">
                        {log.keepContactName}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                      <span className="text-slate-500 text-xs flex-1 truncate">
                        合并 {log.mergedContactNames.join('、')}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
                      <span>跟进 +{log.mergedFollowups}</span>
                      <span>标签 +{log.mergedTags}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 区块 6：危险操作 */}
        <Card className="border border-red-200 shadow-sm hover:shadow-md transition-all duration-200 bg-red-50/30">
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg font-semibold text-red-700">
                  清空数据
                </CardTitle>
                <CardDescription className="text-sm text-red-500 mt-1">
                  清空所有联系人、标签和跟进记录，此操作不可恢复
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  className="w-full bg-red-600 hover:bg-red-700 text-white border-red-600"
                >
                  <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                  清空所有数据
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2 text-red-600">
                    <AlertTriangle className="w-5 h-5" strokeWidth={1.5} />
                    危险操作：清空所有数据
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    此操作将永久删除所有联系人、标签和跟进记录，
                    且<strong>不可恢复</strong>。请谨慎操作。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-2 py-2">
                  <Label htmlFor="clear-confirm">
                    请输入&quot;确认清空&quot;以继续
                  </Label>
                  <Input
                    id="clear-confirm"
                    value={clearConfirmText}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setClearConfirmText(e.target.value)
                    }
                    placeholder="确认清空"
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setClearConfirmText('')}>
                    取消
                  </AlertDialogCancel>
                  <Button
                    variant="destructive"
                    className="bg-red-600 hover:bg-red-700 text-white border-red-600"
                    onClick={handleClearData}
                    disabled={clearConfirmText !== '确认清空' || clearing}
                  >
                    {clearing ? '清空中...' : '确认清空'}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>

        {/* 删除批次确认对话框 */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="w-5 h-5" strokeWidth={1.5} />
                确认删除批次
              </AlertDialogTitle>
              <AlertDialogDescription>
                确定要删除批次「{batchToDelete?.name}」吗？
                该批次下的所有联系人将被<strong>永久删除</strong>，此操作不可恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-700 text-white border-red-600"
                onClick={() => void confirmDeleteBatch()}
                disabled={deletingBatchId !== null}
              >
                {deletingBatchId !== null ? '删除中...' : '确认删除'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 回滚批次确认对话框（时光机） */}
                {/* 批量回滚弹窗（时光机多选/全选） */}
        <BatchMultiRevertDialog
          open={multiRevertOpen}
          onOpenChange={setMultiRevertOpen}
          batches={batches}
          onDone={() => { void loadBatches(); }}
        />

<AlertDialog open={revertDialogOpen} onOpenChange={setRevertDialogOpen}>
          <AlertDialogContent className="max-w-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
                <Undo2 className="w-5 h-5" strokeWidth={1.5} />
                回滚批次
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>
                    批次「{batchToRevert?.name}」采用<strong>保守回滚</strong>：
                    只删除该批次带来、且未被后续操作改动过的数据。
                  </p>
                  {revertDiff && (
                    <>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-md border border-red-200 bg-red-50/60 p-3">
                          <p className="font-medium text-red-700">
                            将删除 {revertDiff.willDelete} 条
                          </p>
                          <p className="text-xs text-red-600/80 mt-1">
                            该批次新建且未被后续操作改动
                          </p>
                        </div>
                        <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
                          <p className="font-medium text-amber-700">
                            将保留 {revertDiff.willKeep} 条
                          </p>
                          <p className="text-xs text-amber-600/80 mt-1">
                            已被后续操作改动，不做破坏性删除
                          </p>
                        </div>
                      </div>
                      {revertDiff.modified.length > 0 && (
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 max-h-40 overflow-y-auto">
                          <p className="text-xs font-medium text-slate-600 mb-1.5">
                            被保留的联系人：
                          </p>
                          <ul className="space-y-1">
                            {revertDiff.modified.slice(0, 20).map((m) => (
                              <li key={m.id} className="text-xs text-slate-500">
                                {m.name} — {m.reason}
                              </li>
                            ))}
                            {revertDiff.modified.length > 20 && (
                              <li className="text-xs text-slate-400">
                                ...另有 {revertDiff.modified.length - 20} 条
                              </li>
                            )}
                          </ul>
                        </div>
                      )}
                      <p className="text-xs text-slate-500">{revertDiff.note}</p>
                      <p className="text-xs text-slate-500">
                        其他批次的数据不受任何影响。
                      </p>
                    </>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                className="bg-amber-600 hover:bg-amber-700 text-white border-amber-600"
                onClick={() => void confirmRevertBatch()}
                disabled={reverting}
              >
                {reverting ? '回滚中...' : '确认回滚'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

export default DataPage;
