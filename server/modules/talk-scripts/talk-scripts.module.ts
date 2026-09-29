import { Module } from '@nestjs/common';
import { TalkScriptsController } from './talk-scripts.controller';
import { TalkScriptsService } from './talk-scripts.service';

@Module({
  controllers: [TalkScriptsController],
  providers: [TalkScriptsService],
  exports: [TalkScriptsService],
})
export class TalkScriptsModule {}
