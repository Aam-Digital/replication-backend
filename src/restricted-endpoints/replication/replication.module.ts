import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ReplicationEndpointsController } from './replication-endpoints/replication-endpoints.controller';
import { DocumentFilterService } from './document-filter/document-filter.service';
import { PermissionModule } from '../../permissions/permission.module';

@Module({
  imports: [HttpModule, PermissionModule],
  controllers: [ReplicationEndpointsController],
  providers: [DocumentFilterService],
})
export class ReplicationModule {}
