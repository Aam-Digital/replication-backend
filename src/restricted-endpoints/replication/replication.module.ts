import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ReplicationEndpointsController } from './replication-endpoints/replication-endpoints.controller';
import { BulkDocumentService } from './bulk-document/bulk-document.service';
import { PermissionModule } from '../../permissions/permission.module';

@Module({
  imports: [HttpModule, PermissionModule],
  controllers: [ReplicationEndpointsController],
  providers: [BulkDocumentService],
})
export class ReplicationModule {}
