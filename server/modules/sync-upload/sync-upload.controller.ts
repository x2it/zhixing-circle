import {
  Controller,
  Post,
  Body,
  Query,
  Param,
} from '@nestjs/common';
import { SyncUploadService } from './sync-upload.service';
import type {
  SyncUploadStartRequest,
  SyncUploadStartResponse,
  SyncUploadChunkRequest,
  SyncUploadChunkResponse,
  SyncUploadCommitResponse,
} from '@shared/api.interface';

@Controller('api/sync/upload')
export class SyncUploadController {
  constructor(private readonly service: SyncUploadService) {}

  /** 开始一次分片上传会话 */
  @Post('start')
  async start(@Body() dto: SyncUploadStartRequest): Promise<SyncUploadStartResponse> {
    return this.service.start(dto);
  }

  /** 上传一片数据（items 数组） */
  @Post('chunk')
  async chunk(
    @Query('uploadId') uploadId: string,
    @Body() dto: SyncUploadChunkRequest,
  ): Promise<SyncUploadChunkResponse> {
    return this.service.chunk(uploadId, dto);
  }

  /** 提交并执行真正的批量写入 */
  @Post('commit')
  async commit(
    @Query('uploadId') uploadId: string,
  ): Promise<SyncUploadCommitResponse<unknown>> {
    return this.service.commit(uploadId);
  }
}
