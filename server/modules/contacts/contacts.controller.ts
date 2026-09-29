import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import { ContactsService, BATCH_LIMIT } from './contacts.service';
import type {
  Contact,
  Followup,
  ContactListQuery,
  ContactListResponse,
  CreateContactRequest,
  UpdateContactRequest,
  BatchArchiveRequest,
  BatchCreateContactsRequest,
  BatchCreateResult,
  BatchByFilterRequest,
  BatchByFilterResponse,
  PrefixStat,
  PrefixCleanRequest,
  PrefixCleanResponse,
  DuplicateGroup,
  MergeContactsRequest,
  MergeContactsResponse,
  MergeLogListResponse,
} from '@shared/api.interface';
import { DataService } from '@server/modules/data/data.service';

@Controller('api/contacts')
export class ContactsController {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly dataService: DataService,
  ) {}

  @Get()
  async findAll(
    @Query('search') search?: string,
    @Query('tier') tier?: string,
    @Query('tagId') tagId?: string,
    @Query('tagIds') tagIds?: string,
    @Query('tagMode') tagMode?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('archived') archived?: string,
    @Query('batchId') batchId?: string,
    @Query('followupStatus') followupStatus?: string,
    @Query('nextFollowupBefore') nextFollowupBefore?: string,
    @Query('nextFollowupAfter') nextFollowupAfter?: string,
    @Query('phoneStatus') phoneStatus?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ): Promise<ContactListResponse> {
    const parsedTagIds = tagIds
      ? [...new Set(tagIds.split(',').map((s) => s.trim()).filter(Boolean))]
      : undefined;
    const query: ContactListQuery = {
      search,
      tier: (tier as ContactListQuery['tier']) ?? undefined,
      tagId,
      tagIds: parsedTagIds,
      tagMode: tagMode === 'all' ? 'all' : 'any',
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      archived: archived === 'all' ? 'all' : archived === 'true',
      batchId: batchId ?? undefined,
      followupStatus: followupStatus as ContactListQuery['followupStatus'],
      nextFollowupBefore: nextFollowupBefore ?? undefined,
      nextFollowupAfter: nextFollowupAfter ?? undefined,
      phoneStatus: phoneStatus === 'with' || phoneStatus === 'without' ? phoneStatus : undefined,
      sortBy: sortBy as ContactListQuery['sortBy'],
      sortOrder: sortOrder as ContactListQuery['sortOrder'],
    };
    return this.contactsService.findAll(query);
  }

  /** 静态路径必须放在 :id 之前，否则会被当作 id 匹配 */
  @Get('duplicates')
  async findDuplicates(): Promise<DuplicateGroup[]> {
    return this.contactsService.findDuplicates();
  }

  @Get('prefix-analysis')
  async analyzePrefixes(): Promise<PrefixStat[]> {
    return this.contactsService.analyzePrefixes();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Contact & { followups: Followup[] }> {
    return this.contactsService.findOne(id);
  }

  /** 某个联系人的合并记录（前端「联系人详情」页调用） */
  @Get(':id/merge-logs')
  async getMergeLogs(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<MergeLogListResponse> {
    return this.dataService.getMergeLogs(
      page ? parseInt(page, 10) || 1 : 1,
      pageSize ? parseInt(pageSize, 10) || 20 : 20,
      id,
    );
  }

  @Post()
  async create(@Body() dto: CreateContactRequest): Promise<Contact> {
    return this.contactsService.create(dto);
  }

  /** 批量创建（App 同步用, 单次最多 100 条, externalId 幂等） */
  @Post('batch')
  async batchCreate(@Body() dto: BatchCreateContactsRequest): Promise<BatchCreateResult<Contact>> {
    return this.contactsService.batchCreate(dto);
  }

  // 前端 api 层使用 PATCH；历史/App 客户端使用 PUT。NestJS 同一方法只认一个路由装饰器，
  // 因此拆成两个方法指向同一 service（用单个 handler 便于维护，见 updateByPut）。
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateContactRequest): Promise<Contact> {
    return this.contactsService.update(id, dto);
  }

  @Patch(':id')
  async updateByPatch(@Param('id') id: string, @Body() dto: UpdateContactRequest): Promise<Contact> {
    return this.contactsService.update(id, dto);
  }

  @Patch(':id/tier')
  async updateTier(@Param('id') id: string, @Body() body: { tier?: string }): Promise<Contact> {
    if (!body?.tier) {
      throw new BadRequestException('tier 不能为空');
    }
    return this.contactsService.updateTier(id, body.tier);
  }

  /**
   * 批量删除联系人（App 端 v2.7.0 契约）。
   *
   * 路由必须写在 @Delete(':id') 之前，否则 'batch' 会被 ':id' 抢先匹配。
   * 鉴权由全局中间件完成（?api_key=zx_* 或 X-API-Key），无需在此重复校验。
   */
  @Delete()
  @HttpCode(200)
  async batchDelete(@Body() body: { ids?: unknown }): Promise<{ deleted: number }> {
    const raw = body?.ids;
    if (!Array.isArray(raw)) {
      throw new BadRequestException('ids 必须为数组');
    }
    const ids = [...new Set(raw.filter((i): i is string => typeof i === 'string' && i.trim() !== ''))];
    if (ids.length === 0) {
      throw new BadRequestException('ids 不能为空');
    }
    if (ids.length > BATCH_LIMIT) {
      throw new BadRequestException(`单批最多 ${BATCH_LIMIT} 条`);
    }
    const deleted = await this.contactsService.batchDelete(ids);
    // 幂等：不存在的 id 静默跳过，仍返回 200（App 只看状态码，重试安全）
    return { deleted };
  }

  /**
   * 批量删除联系人（POST 版，App v2.7.1+ 契约：`POST /contacts/batch-delete`）。
   *
   * 背景：App 侧实测公网网关拦截 DELETE 方法，v2.7.1 起统一改用 POST。
   * 契约与 DELETE 版完全一致：body { "ids": [...] }，≤200/批，用户隔离，幂等。
   */
  @Post('batch-delete')
  async batchDeletePost(@Body() body: { ids?: unknown }): Promise<{ deleted: number }> {
    return this.batchDelete(body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.contactsService.remove(id);
    return { success: true };
  }

  @Post('batch-archive')
  async batchArchive(@Body() dto: BatchArchiveRequest): Promise<{ updated: number }> {
    return this.contactsService.batchArchive(dto);
  }

  @Post('batch-by-filter')
  async batchByFilter(@Body() dto: BatchByFilterRequest): Promise<BatchByFilterResponse> {
    return this.contactsService.batchByFilter(dto);
  }

  @Post('prefix-clean')
  async cleanPrefix(@Body() dto: PrefixCleanRequest): Promise<PrefixCleanResponse> {
    return this.contactsService.cleanPrefix(dto);
  }

  @Post('merge')
  async mergeContacts(@Body() dto: MergeContactsRequest): Promise<MergeContactsResponse> {
    return this.contactsService.mergeContacts(dto);
  }
}
