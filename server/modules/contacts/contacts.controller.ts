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
} from '@nestjs/common';
import { ContactsService } from './contacts.service';
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
