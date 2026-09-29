import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { FollowupsService } from './followups.service';
import type { Followup, CreateFollowupRequest, BatchCreateFollowupsRequest, BatchCreateResult } from '@shared/api.interface';

@Controller('api')
export class FollowupsController {
  constructor(private readonly followupsService: FollowupsService) {}

  @Get('followups')
  async listAll(@Query() query: {
    contactId?: string;
    page?: string;
    pageSize?: string;
  }): Promise<Followup[]> {
    return this.followupsService.listAll({
      contactId: query.contactId,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  /** 文档标准路由: body 中携带 contactId */
  @Post('followups')
  async createWithBody(@Body() body: CreateFollowupRequest): Promise<Followup> {
    return this.followupsService.create(body.contactId, body);
  }

  /** 批量创建跟进（App 同步用, 单次最多 100 条） */
  @Post('followups/batch')
  async batchCreate(@Body() body: BatchCreateFollowupsRequest): Promise<BatchCreateResult<Followup>> {
    return this.followupsService.batchCreate(body);
  }

  @Get('contacts/:contactId/followups')
  async listByContact(@Param('contactId') contactId: string): Promise<Followup[]> {
    return this.followupsService.listByContact(contactId);
  }

  @Post('contacts/:contactId/followups')
  async create(
    @Param('contactId') contactId: string,
    @Body() body: CreateFollowupRequest,
  ): Promise<Followup> {
    return this.followupsService.create(contactId, body);
  }

  /** 文档标准路由: PUT */
  @Put('followups/:id')
  async update(
    @Param('id') id: string,
    @Body() body: Partial<CreateFollowupRequest>,
  ): Promise<Followup> {
    return this.followupsService.update(id, body);
  }

  /** 兼容路由: PATCH（客户端实现不一致时均可调用） */
  @Patch('followups/:id')
  async updateViaPatch(
    @Param('id') id: string,
    @Body() body: Partial<CreateFollowupRequest>,
  ): Promise<Followup> {
    return this.followupsService.update(id, body);
  }

  @Delete('followups/:id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    return this.followupsService.remove(id);
  }
}
