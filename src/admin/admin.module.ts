import { Module } from '@nestjs/common';
import { AdminController } from './admin/admin.controller';
import { PermissionModule } from '../permissions/permission.module';
import { CouchdbModule } from '../couchdb/couchdb.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  controllers: [AdminController],
  imports: [PermissionModule, CouchdbModule, AuthModule],
})
export class AdminModule {}
