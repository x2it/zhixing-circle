import { Controller, Get, Post, Put, Delete, Body, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TemplatesService } from './templates.service';
import type {
  ContactTemplate,
  CreateTemplateRequest,
  UpdateTemplateRequest,
  DuplicateTemplateRequest,
  ResetAllTemplatesRequest,
  ApplyTemplateResponse,
} from '@shared/api.interface';

@Controller('api/templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get('presets/list')
  async getPresets(): Promise<ContactTemplate[]> {
    return this.templatesService.findPresets();
  }

  /** 当前正在使用的模板（静态路径必须声明在 @Get(':id') 之前） */
  @Get('active/current')
  async getActive(): Promise<ContactTemplate | null> {
    return this.templatesService.getActive();
  }

  @Get()
  async findAll(): Promise<ContactTemplate[]> {
    return this.templatesService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ContactTemplate> {
    return this.templatesService.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateTemplateRequest): Promise<ContactTemplate> {
    return this.templatesService.create(dto);
  }

  /** 恢复出厂：删除当前用户全部自定义方案并重置生效配置（静态路径，需显式确认） */
  @Post('reset-all')
  async resetAll(@Body() dto: ResetAllTemplatesRequest): Promise<{ removedTemplates: number }> {
    return this.templatesService.resetAll(dto);
  }

  /** 另存为新方案：预设或自定义均可复制为当前用户的新自定义方案 */
  @Post(':id/duplicate')
  async duplicate(
    @Param('id') id: string,
    @Body() dto: DuplicateTemplateRequest,
  ): Promise<ContactTemplate> {
    return this.templatesService.duplicate(id, dto ?? {});
  }

  /** 重置自定义方案：恢复为「另存那一刻」的初始内容（baseSnapshot） */
  @Post(':id/reset')
  async reset(@Param('id') id: string): Promise<ContactTemplate> {
    return this.templatesService.reset(id);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateRequest,
  ): Promise<ContactTemplate> {
    return this.templatesService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.templatesService.remove(id);
    return { success: true };
  }

  @Post(':id/apply')
  async apply(@Param('id') id: string, @Req() req: Request): Promise<ApplyTemplateResponse> {
    const { userId } = req.userContext;
    return this.templatesService.apply(id, userId);
  }
}
