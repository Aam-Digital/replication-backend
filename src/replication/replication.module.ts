import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CouchProxyController } from './couch-proxy/couch-proxy.controller';
import { DocumentFilterService } from './document-filter/document-filter.service';
import { SessionModule } from '../session/session.module';
import { RulesService } from './rules/rules.service';
import { PermissionService } from './permission/permission.service';
import { RulesController } from './rules/rules.controller';

@Module({
  imports: [HttpModule, SessionModule],
  controllers: [CouchProxyController, RulesController],
  providers: [DocumentFilterService, RulesService, PermissionService],
})
export class ReplicationModule {}
