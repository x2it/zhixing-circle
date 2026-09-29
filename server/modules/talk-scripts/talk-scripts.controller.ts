import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { TalkScriptsService } from './talk-scripts.service';
import type {
  TalkScript,
  CreateTalkScriptRequest,
  UpdateTalkScriptRequest,
} from '@shared/api.interface';

/**
 * 话术模板：GET /api/talk-scripts 等
 * 预设话术为只读系统内置，用户自定义话术按 userId 隔离存储。
 */
@Controller('api')
export class TalkScriptsController {
  constructor(private readonly talkScriptsService: TalkScriptsService) {}

  @Get('talk-scripts')
  async findAll(): Promise<TalkScript[]> {
    return this.talkScriptsService.findAll();
  }

  @Get('talk-scripts/:id')
  async findOne(@Param('id') id: string): Promise<TalkScript> {
    return this.talkScriptsService.findOne(id);
  }

  @Post('talk-scripts')
  async create(@Body() dto: CreateTalkScriptRequest): Promise<TalkScript> {
    return this.talkScriptsService.create(dto);
  }

  @Patch('talk-scripts/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateTalkScriptRequest): Promise<TalkScript> {
    return this.talkScriptsService.update(id, dto);
  }

  @Delete('talk-scripts/:id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.talkScriptsService.remove(id);
    return { success: true };
  }
}
