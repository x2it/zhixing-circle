import { Module } from '@nestjs/common';
import { SkillMdController } from './skill-md.controller';

@Module({
  controllers: [SkillMdController],
})
export class SkillMdModule {}
