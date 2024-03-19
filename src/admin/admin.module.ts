import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { PermissionModule } from '../permissions/permission.module';
import { CouchdbModule } from '../couchdb/couchdb.module';
import { AuthModule } from '../auth/auth.module';
import { AdminService } from './admin.service';

@Module({
  controllers: [AdminController],
  imports: [PermissionModule, CouchdbModule, AuthModule],
  providers: [AdminService],
})
export class AdminModule {}
