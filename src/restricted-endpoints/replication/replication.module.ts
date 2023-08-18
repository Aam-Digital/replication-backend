import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ReplicationEndpointsController } from './replication-endpoints/replication-endpoints.controller';
import { BulkDocumentService } from './bulk-document/bulk-document.service';
import { PermissionModule } from '../../permissions/permission.module';
import { AuthModule } from '../../auth/auth.module';
import { BulkDocEndpointsController } from './bulk-document/bulk-doc-endpoints.controller';

@Module({
  imports: [HttpModule, PermissionModule, AuthModule],
  controllers: [ReplicationEndpointsController, BulkDocEndpointsController],
  providers: [BulkDocumentService],
})
export class ReplicationModule {}
