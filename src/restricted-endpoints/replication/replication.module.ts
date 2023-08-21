import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { InfoEndpointsController } from './replication-endpoints/info-endpoints.controller';
import { BulkDocumentService } from './bulk-document/bulk-document.service';
import { PermissionModule } from '../../permissions/permission.module';
import { AuthModule } from '../../auth/auth.module';
import { BulkDocEndpointsController } from './bulk-document/bulk-doc-endpoints.controller';
import { ChangesController } from './changes/changes.controller';

@Module({
  imports: [HttpModule, PermissionModule, AuthModule],
  controllers: [
    ChangesController,
    InfoEndpointsController,
    BulkDocEndpointsController,
  ],
  providers: [BulkDocumentService],
})
export class ReplicationModule {}
