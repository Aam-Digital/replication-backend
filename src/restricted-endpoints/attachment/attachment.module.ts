import { Module } from '@nestjs/common';
import { AttachmentController } from './attachment/attachment.controller';
import { PermissionModule } from '../../permissions/permission.module';
import { CouchdbModule } from '../../couchdb/couchdb.module';
import { AuthModule } from '../../auth/auth.module';

@Module({
  controllers: [AttachmentController],
  imports: [PermissionModule, CouchdbModule, AuthModule],
})
export class AttachmentModule {}
