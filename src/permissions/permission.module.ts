import { Module } from '@nestjs/common';
import { RulesService } from './rules/rules.service';
import { PermissionService } from './permission/permission.service';
import { RulesController } from './rules/rules.controller';
import { HttpService } from '@nestjs/axios';

@Module({
  imports: [HttpService],
  controllers: [RulesController],
  providers: [RulesService, PermissionService],
  exports: [PermissionService]
})
export class PermissionModule {}
