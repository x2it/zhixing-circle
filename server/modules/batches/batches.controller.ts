import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
} from '@nestjs/common';
import { BatchesService } from './batches.service';
import type {
  ImportBatch,
  ImportBatchListResponse,
  BatchDetailResponse,
  BatchDiffResponse,
  BatchRevertResponse,
  BatchRevertMultiResponse,
  RevertBatchesMultiRequest,
  MergeBatchesRequest,
  OperationLogListResponse,
} from '@shared/api.interface';

@Controller('api/batches')
export class BatchesController {
  constructor(private readonly batchesService: BatchesService) {}

  @Get()
  async findAll(): Promise<ImportBatchListResponse> {
    return this.batchesService.findAll();
  }

  /** 操作流水（放在 :id 之前，避免被参数路由吞掉） */
  @Get('operations/logs')
  async getOperations(@Query('limit') limit?: string): Promise<OperationLogListResponse> {
    return this.batchesService.getOperations(limit ? parseInt(limit, 10) : 50);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ImportBatch> {
    return this.batchesService.findOne(id);
  }

  /** 批次详情（含联系人清单） */
  @Get(':id/detail')
  async getDetail(@Param('id') id: string): Promise<BatchDetailResponse> {
    return this.batchesService.getDetail(id);
  }

  /** 回滚预览：先看会发生什么，再决定是否执行 */
  @Get(':id/diff')
  async getDiff(@Param('id') id: string): Promise<BatchDiffResponse> {
    return this.batchesService.getDiff(id);
  }

  /** 保守回滚该批次 */
  @Post(':id/revert')
  async revert(@Param('id') id: string): Promise<BatchRevertResponse> {
    return this.batchesService.revert(id);
  }

  /** 合并多个碎片批次为一个（静态路径必须放在 :id 之前） */
  @Post('merge')
  async merge(@Body() dto: MergeBatchesRequest): Promise<ImportBatch> {
    return this.batchesService.merge(dto);
  }

  /** 批量回滚（时光机多选/全选，静态路径放在 :id 之前） */
  @Post('revert-multi')
  async revertMulti(@Body() dto: RevertBatchesMultiRequest): Promise<BatchRevertMultiResponse> {
    return this.batchesService.revertMulti(dto);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
  ): Promise<{ success: boolean; deletedContacts: number }> {
    return this.batchesService.remove(id);
  }
}
