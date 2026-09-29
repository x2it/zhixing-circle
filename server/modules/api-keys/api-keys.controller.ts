import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import type {
  ApiKeyInfo,
  ApiKeyListResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  UpdateApiKeyRequest,
} from '@shared/api.interface';

/**
 * API 密钥管理
 * - 密钥与「创建它的用户」强绑定：无论权限多高，都只能操作该用户自己的数据
 * - 创建时可指定权限级别（read/write/admin）与每分钟速率上限
 * - 缺省即全权（admin）+ 不限速，保证智能体/脚本具备与账号同等甚至更强的能力
 */
@Controller('api/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Get()
  async list(): Promise<ApiKeyListResponse> {
    return this.apiKeysService.list();
  }

  /** 创建密钥：可传 name / scope / rateLimitPerMin / allowedOps / deniedOps */
  @Post()
  async create(@Body() dto: CreateApiKeyRequest = {}): Promise<CreateApiKeyResponse> {
    return this.apiKeysService.create(dto ?? {});
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<ApiKeyInfo> {
    return this.apiKeysService.detail(id);
  }

  /** 调整名称 / 权限 / 速率（只影响归属用户自己的密钥） */
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateApiKeyRequest,
  ): Promise<ApiKeyInfo> {
    return this.apiKeysService.update(id, dto ?? {});
  }

  /** 重置密钥（换发新明文，继承原权限） */
  @Post(':id/reset')
  async reset(@Param('id') id: string): Promise<CreateApiKeyResponse> {
    return this.apiKeysService.reset(id);
  }

  @Delete(':id')
  async revoke(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.apiKeysService.revoke(id);
    return { success: true };
  }
}
