import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CouchProxyController } from './couch-proxy/couch-proxy.controller';
import { DocumentFilterService } from './document-filter/document-filter.service';
import { SessionModule } from '../session/session.module';
import { PermissionModule } from '../permissions/permission.module';

@Module({
  imports: [HttpModule, SessionModule, PermissionModule],
  controllers: [CouchProxyController],
  providers: [DocumentFilterService],
})
export class ReplicationModule {}
