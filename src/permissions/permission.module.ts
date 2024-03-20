import { Module } from '@nestjs/common';
import { RulesService } from './rules/rules.service';
import { PermissionService } from './permission/permission.service';
import { HttpModule } from '@nestjs/axios';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [HttpModule, AdminModule],
  providers: [RulesService, PermissionService],
  exports: [RulesService, PermissionService],
})
export class PermissionModule {}
