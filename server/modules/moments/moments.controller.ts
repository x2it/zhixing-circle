import { Controller, Get, Put, Body } from '@nestjs/common';
import { MomentsService } from './moments.service';
import type {
  MomentsConfigResponse,
  UpdateMomentsConfigRequest,
} from '@shared/api.interface';

@Controller('api/moments')
export class MomentsController {
  constructor(private readonly momentsService: MomentsService) {}

  @Get('config')
  async getConfig(): Promise<MomentsConfigResponse> {
    return this.momentsService.getConfig();
  }

  @Put('config')
  async updateConfig(@Body() dto: UpdateMomentsConfigRequest): Promise<MomentsConfigResponse> {
    return this.momentsService.updateConfig(dto ?? {});
  }
}
