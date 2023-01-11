import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ReplicationEndpointsController } from './replication-endpoints/replication-endpoints.controller';
import { BulkDocumentService } from './bulk-document/bulk-document.service';
import { PermissionModule } from '../../permissions/permission.module';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [HttpModule, PermissionModule, AuthModule],
  controllers: [ReplicationEndpointsController],
  providers: [BulkDocumentService],
})
export class ReplicationModule {}
