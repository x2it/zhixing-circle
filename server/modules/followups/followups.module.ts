import { Module } from '@nestjs/common';
import { FollowupsController } from './followups.controller';
import { FollowupsService } from './followups.service';

@Module({
  controllers: [FollowupsController],
  providers: [FollowupsService],
  exports: [FollowupsService],
})
export class FollowupsModule {}
