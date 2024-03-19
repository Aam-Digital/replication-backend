import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { CouchdbModule } from '../couchdb/couchdb.module';
import { AuthModule } from '../auth/auth.module';
import { AdminService } from './admin.service';

@Module({
  controllers: [AdminController],
  imports: [CouchdbModule, AuthModule],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
