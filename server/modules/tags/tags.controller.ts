import { Controller, Get, Post, Put, Patch, Delete, Body, Param } from '@nestjs/common';
import { TagsService } from './tags.service';
import type { Tag, CreateTagRequest, UpdateTagRequest } from '@shared/api.interface';

@Controller('api/tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  async findAll(): Promise<{ items: Tag[] }> {
    const items = await this.tagsService.findAll();
    return { items };
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Tag> {
    return this.tagsService.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateTagRequest): Promise<Tag> {
    return this.tagsService.create(dto);
  }

  // 前端 api 层使用 PATCH；保留 PUT 兼容历史客户端。NestJS 同一方法只认一个路由装饰器，故拆两个方法。
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTagRequest): Promise<Tag> {
    return this.tagsService.update(id, dto);
  }

  @Patch(':id')
  async updateByPatch(@Param('id') id: string, @Body() dto: UpdateTagRequest): Promise<Tag> {
    return this.tagsService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.tagsService.remove(id);
    return { success: true };
  }
}
