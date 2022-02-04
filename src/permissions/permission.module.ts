import { Module } from '@nestjs/common';
import { RulesService } from './rules/rules.service';
import { PermissionService } from './permission/permission.service';
import { RulesController } from './rules/rules.controller';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [HttpModule, AuthModule],
  controllers: [RulesController],
  providers: [RulesService, PermissionService],
  exports: [PermissionService],
})
export class PermissionModule {}
