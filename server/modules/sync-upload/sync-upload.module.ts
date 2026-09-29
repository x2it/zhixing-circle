import { Module } from '@nestjs/common';
import { SyncUploadService } from './sync-upload.service';
import { SyncUploadController } from './sync-upload.controller';
import { ContactsModule } from '@server/modules/contacts/contacts.module';
import { MessagesModule } from '@server/modules/messages/messages.module';
import { CallsModule } from '@server/modules/calls/calls.module';

@Module({
  imports: [ContactsModule, MessagesModule, CallsModule],
  controllers: [SyncUploadController],
  providers: [SyncUploadService],
  exports: [SyncUploadService],
})
export class SyncUploadModule {}
