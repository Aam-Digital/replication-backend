import { Module } from '@nestjs/common';
import { RulesService } from './rules/rules.service';
import { PermissionService } from './permission/permission.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  providers: [RulesService, PermissionService],
  exports: [RulesService, PermissionService],
})
export class PermissionModule {}
