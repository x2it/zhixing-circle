import { Controller, Get, Post, Body } from '@nestjs/common';
import { SyncStatusService } from './sync-status.service';
import type {
  SyncStatus,
  DeviceHandshakeRequest,
  DeviceHandshakeResponse,
  SyncHealthResponse,
} from '@shared/api.interface';

/** 备份同步状态 / 设备握手 / 同步健康 */
@Controller('api')
export class SyncStatusController {
  constructor(private readonly syncStatusService: SyncStatusService) {}

  @Get('settings/sync-status')
  async getStatus(): Promise<SyncStatus> {
    return this.syncStatusService.getStatus();
  }

  /** 设备握手：App 启动时上报环境/能力，云端下发限制与特性开关 */
  @Post('settings/sync-handshake')
  async handshake(@Body() dto: DeviceHandshakeRequest): Promise<DeviceHandshakeResponse> {
    return this.syncStatusService.handshake(dto ?? { deviceId: '' });
  }

  /** 设备与同步健康（Web 端数据页展示） */
  @Get('settings/sync-health')
  async getSyncHealth(): Promise<SyncHealthResponse> {
    return this.syncStatusService.getSyncHealth();
  }
}
