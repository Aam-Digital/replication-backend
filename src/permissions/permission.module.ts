import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { PermissionCheckController } from './permission-check/permission-check.controller';
import { PermissionService } from './permission/permission.service';
import { RulesService } from './rules/rules.service';
import { KeycloakUserAdminService } from './user-identity/keycloak-user-admin.service';
import { UserAdminService } from './user-identity/user-admin.service';
import { UserIdentityService } from './user-identity/user-identity.service';

@Module({
  imports: [HttpModule, AdminModule, AuthModule],
  controllers: [PermissionCheckController],
  providers: [
    RulesService,
    PermissionService,
    UserIdentityService,
    {
      provide: UserAdminService,
      useClass: KeycloakUserAdminService,
    },
  ],
  exports: [RulesService, PermissionService],
})
export class PermissionModule {}
