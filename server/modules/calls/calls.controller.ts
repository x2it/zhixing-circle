import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import type { Call, CallListResponse, CallSyncSetting } from '@shared/api.interface';
import { CallsService } from './calls.service';

@Controller('api')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  /** 通话记录同步开关状态（App 同步前检查，默认关闭） */
  @Get('settings/call-sync')
  async getSyncSetting(): Promise<CallSyncSetting> {
    return this.callsService.getSyncSetting();
  }

  /** 切换通话记录同步开关 */
  @Put('settings/call-sync')
  async setSyncSetting(@Body() body: { enabled: boolean }): Promise<CallSyncSetting> {
    return this.callsService.setSyncSetting(body?.enabled === true);
  }

  /** 通话记录列表（分页，按 callDate 倒序），开关关闭时返回 403 */
  @Get('calls')
  async findAll(@Query() query: {
    page?: string;
    pageSize?: string;
    contactId?: string;
    phone?: string;
    keyword?: string;
    dateFrom?: string;
    dateTo?: string;
    direction?: string;
  }): Promise<CallListResponse> {
    return this.callsService.findAll({
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
      contactId: query.contactId,
      phone: query.phone,
      keyword: query.keyword,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      direction: query.direction,
    });
  }

  /** 上报通话记录，contactId 可空 */
  @Post('calls')
  async create(@Body() dto: {
    contactId?: string;
    phone: string;
    direction: string;
    duration?: number;
    callDate: string;
    note?: string;
  }): Promise<Call> {
    return this.callsService.create(dto);
  }

  /** 批量上报通话记录（App 同步用，单次最多 100 条；开关关闭时整体 403） */
  @Post('calls/batch')
  async batchCreate(@Body() dto: {
    items: Array<{
      contactId?: string;
      phone: string;
      direction: string;
      duration?: number;
      callDate: string;
      note?: string;
    }>;
  }): Promise<{ items: Call[]; errors?: Array<{ index: number; message: string }>; created: number }> {
    return this.callsService.batchCreate(dto);
  }

  /** 删除单条通话记录（管理操作，不受同步开关限制） */
  @Delete('calls/:id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.callsService.remove(id);
    return { success: true };
  }

  /** 批量删除通话记录（管理清理用）：body 传 { "ids": [...] } */
  @Delete('calls')
  async removeMany(@Body() body: { ids?: string[]; phone?: string; all?: boolean }): Promise<{ deleted: number }> {
    return this.callsService.removeMany({
      ids: Array.isArray(body?.ids) ? body.ids : undefined,
      phone: body?.phone,
      all: body?.all,
    });
  }
}
