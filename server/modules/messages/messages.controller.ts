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
import type {
  CreateMessageRequest,
  Message,
  MessageListResponse,
  ConversationListResponse,
  SmsSyncSetting,
  BatchCreateMessagesRequest,
  BatchCreateResult,
} from '@shared/api.interface';

import { MessagesService } from './messages.service';

@Controller('api')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  /** 短信同步开关状态（App 同步前检查） */
  @Get('settings/sms-sync')
  async getSyncSetting(): Promise<SmsSyncSetting> {
    return this.messagesService.getSyncSetting();
  }

  /** 切换短信同步开关 */
  @Put('settings/sms-sync')
  async setSyncSetting(@Body() body: { enabled: boolean }): Promise<SmsSyncSetting> {
    return this.messagesService.setSyncSetting(body?.enabled === true);
  }

  /** 短信列表（分页），开关关闭时返回 403 */
  @Get('messages')
  async findAll(@Query() query: {
    page?: string;
    pageSize?: string;
    contactId?: string;
    phone?: string;
    keyword?: string;
    dateFrom?: string;
    dateTo?: string;
    direction?: string;
  }): Promise<MessageListResponse> {
    return this.messagesService.findAll({
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

  /** 短信会话列表（按号码聚合，聊天式浏览），开关关闭时返回 403 */
  @Get('messages/conversations')
  async findConversations(@Query() query: {
    page?: string;
    pageSize?: string;
    keyword?: string;
  }): Promise<ConversationListResponse> {
    return this.messagesService.findConversations({
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
      keyword: query.keyword,
    });
  }

  /** 上报短信，contactId 可空 */
  @Post('messages')
  async create(@Body() dto: CreateMessageRequest): Promise<Message> {
    return this.messagesService.create(dto);
  }

  /** 批量上报短信（App 同步用, 单次最多 100 条；开关关闭时整体返回 403） */
  @Post('messages/batch')
  async batchCreate(@Body() dto: BatchCreateMessagesRequest): Promise<BatchCreateResult<Message>> {
    return this.messagesService.batchCreate(dto);
  }

  /**
   * 删除单条短信。
   * 删除属于数据管理操作，不受「短信同步开关」限制（避免关闭态下残留数据无法清理）。
   */
  @Delete('messages/:id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.messagesService.remove(id);
    return { success: true };
  }

  /**
   * 批量删除短信（管理清理用），body 三选一：
   * { "ids": [...] } 按 id / { "phone": "138..." } 删除整个会话 / { "all": true } 清空全部
   * 返回实际删除条数
   */
  @Delete('messages')
  async removeMany(@Body() body: { ids?: string[]; phone?: string; all?: boolean }): Promise<{ deleted: number }> {
    return this.messagesService.removeMany({
      ids: Array.isArray(body?.ids) ? body.ids : undefined,
      phone: body?.phone,
      all: body?.all,
    });
  }
}
