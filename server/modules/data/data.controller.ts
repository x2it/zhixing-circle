import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DataService } from './data.service';
import type {
  ExportData,
  DataQualityStats,
  DedupPreviewResponse,
  DedupExecuteRequest,
  DedupExecuteResponse,
  PhoneNormalizeResult,
  TierSuggestionResponse,
  TierSuggestionApplyRequest,
  NicknameCleanPreviewRequest,
  NicknameCleanPreviewResponse,
  NicknameCleanExecuteRequest,
  NicknameCleanExecuteResponse,
  TagInferPreviewRequest,
  TagInferPreviewResponse,
  TagInferApplyRequest,
  TagInferApplyResponse,
  XlsxImportRequest,
  XlsxImportResponse,
  CommDedupPreviewResponse,
  CommDedupExecuteRequest,
  CommDedupExecuteResponse,
  MergeLogListResponse,
  BatchTierUpdateRequest,
  BatchTagRequest,
  BatchDeleteNoPhoneResponse,
  WorkAppExcelImportRequest,
  ContactImportRequest,
  ImportResult,
} from '@shared/api.interface';

@Controller('api/data')
export class DataController {
  constructor(private readonly dataService: DataService) {}

  @Get('export/json')
  async exportJson(
    @Query('batchId') batchId?: string,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<ExportData> {
    return this.dataService.exportJson({
      batchId: batchId || undefined,
      includeArchived: includeArchived === 'true',
    });
  }

  @Get('export/csv')
  async exportCsv(
    @Res() res: Response,
    @Query('batchId') batchId?: string,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<void> {
    const csv = await this.dataService.exportCsv({
      batchId: batchId || undefined,
      includeArchived: includeArchived === 'true',
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    res.send(csv);
  }

  @Post('import/json')
  async importJson(
    @Body() body: ExportData,
  ): Promise<{ success: boolean; imported: { contacts: number; tags: number; followups: number } }> {
    return this.dataService.importJson(body);
  }

  @Post('import/xlsx')
  async importXlsx(@Body() body: XlsxImportRequest): Promise<XlsxImportResponse> {
    return this.dataService.importXlsx(body);
  }

  /** 工作 APP Excel 导入 */
  @Post('import/workapp-excel')
  async importWorkAppExcel(@Body() body: WorkAppExcelImportRequest): Promise<ImportResult> {
    return this.dataService.importWorkAppExcel(body);
  }

  /** 通用联系人导入 */
  @Post('import/contacts')
  async importContacts(@Body() body: ContactImportRequest): Promise<ImportResult> {
    return this.dataService.importContacts(body);
  }

  /** 导出工作 APP Excel（CSV 兼容，前端可另存为表格） */
  @Get('export/workapp-excel')
  async exportWorkAppExcel(@Res() res: Response): Promise<void> {
    const csv = await this.dataService.exportWorkAppCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="workapp-contacts.csv"');
    res.send(csv);
  }

  /** 导出 vCard，可直接导入手机通讯录（含 CATEGORIES 分组） */
  @Get('export/vcf')
  async exportVcf(@Res() res: Response): Promise<void> {
    const vcf = await this.dataService.exportVcf();
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.vcf"');
    res.send(vcf);
  }

  // ========== 批量操作 ==========

  @Post('batch/tier')
  async batchUpdateTier(@Body() body: BatchTierUpdateRequest): Promise<{ updated: number }> {
    return this.dataService.batchUpdateTier(body);
  }

  @Post('batch/tags')
  async batchAddTags(@Body() body: BatchTagRequest): Promise<{ updated: number }> {
    return this.dataService.batchAddTags(body);
  }

  @Post('batch/delete-no-phone')
  async batchDeleteNoPhone(): Promise<BatchDeleteNoPhoneResponse> {
    return this.dataService.batchDeleteNoPhone();
  }

  @Post('seed-examples')
  async seedExamples(): Promise<{ success: boolean; count: number; batchId: string }> {
    return this.dataService.seedExamples();
  }

  @Post('clear')
  async clearAll(): Promise<{ success: boolean; cleared: { contacts: number; tags: number; followups: number; batches: number; messages: number } }> {
    return this.dataService.clearAll();
  }

  // ========== Data Quality ==========

  @Get('quality')
  async getQualityStats(): Promise<DataQualityStats> {
    return this.dataService.getQualityStats();
  }

  // ========== Dedup ==========

  @Get('dedup/preview')
  async getDedupPreview(): Promise<DedupPreviewResponse> {
    return this.dataService.getDedupPreview();
  }

  @Post('dedup/execute')
  async executeDedup(@Body() body: DedupExecuteRequest): Promise<DedupExecuteResponse> {
    return this.dataService.executeDedup(body);
  }

  // ========== Comm Dedup（短信/通话去重） ==========

  @Get('comm-dedup/preview')
  async getCommDedupPreview(): Promise<CommDedupPreviewResponse> {
    return this.dataService.getCommDedupPreview();
  }

  @Post('comm-dedup/execute')
  async executeCommDedup(@Body() body: CommDedupExecuteRequest): Promise<CommDedupExecuteResponse> {
    return this.dataService.executeCommDedup(body);
  }

  // ========== Merge Logs ==========

  @Get('merge-logs')
  async getMergeLogs(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('contactId') contactId?: string,
  ): Promise<MergeLogListResponse> {
    const pageNum = parseInt(page || '1', 10) || 1;
    const pageSizeNum = parseInt(pageSize || '20', 10) || 20;
    return this.dataService.getMergeLogs(pageNum, pageSizeNum, contactId || undefined);
  }

  // ========== Phone Normalization ==========

  @Post('normalize-phones')
  async normalizePhones(): Promise<PhoneNormalizeResult> {
    return this.dataService.normalizePhones();
  }

  // ========== Tier Suggestions ==========

  @Get('tier-suggestions')
  async getTierSuggestions(): Promise<TierSuggestionResponse> {
    return this.dataService.getTierSuggestions();
  }

  @Post('tier-suggestions/apply')
  async applyTierSuggestions(@Body() body: TierSuggestionApplyRequest): Promise<{ updated: number }> {
    return this.dataService.applyTierSuggestions(body);
  }

  // ========== Nickname Clean ==========

  @Post('nickname/clean/preview')
  async getNicknameCleanPreview(@Body() body: NicknameCleanPreviewRequest): Promise<NicknameCleanPreviewResponse> {
    return this.dataService.getNicknameCleanPreview(body);
  }

  @Post('nickname/clean/execute')
  async executeNicknameClean(@Body() body: NicknameCleanExecuteRequest): Promise<NicknameCleanExecuteResponse> {
    return this.dataService.executeNicknameClean(body);
  }

  @Post('tag-infer/preview')
  async getTagInferPreview(@Body() body: TagInferPreviewRequest): Promise<TagInferPreviewResponse> {
    return this.dataService.getTagInferPreview(body);
  }

  @Post('tag-infer/apply')
  async applyTagInfer(@Body() body: TagInferApplyRequest): Promise<TagInferApplyResponse> {
    return this.dataService.applyTagInfer(body);
  }
}
