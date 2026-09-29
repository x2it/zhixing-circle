import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { DataModule } from '@server/modules/data/data.module';

@Module({
  imports: [DataModule],
  controllers: [ContactsController],
  providers: [ContactsService],
  // 导出给 SyncUploadModule 复用（分片上传最终仍走同一套批量写入逻辑）
  exports: [ContactsService],
})
export class ContactsModule {}
