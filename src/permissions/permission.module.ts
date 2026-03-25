import { HttpService } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { PermissionCheckController } from './permission-check/permission-check.controller';
import { PermissionService } from './permission/permission.service';
import { RulesService } from './rules/rules.service';
import { KeycloakUserAdminService } from './user-identity/keycloak-user-admin.service';
import { UserAdminService } from './user-identity/user-admin.service';
import { UserIdentityService } from './user-identity/user-identity.service';

export const KEYCLOAK_HTTP_SERVICE = 'KEYCLOAK_HTTP_SERVICE';

@Module({
  imports: [AdminModule, AuthModule],
  controllers: [PermissionCheckController],
  providers: [
    RulesService,
    PermissionService,
    UserIdentityService,
    {
      // Dedicated Axios instance for Keycloak calls.
      // The global CouchdbModule taints the default HttpService with
      // CouchDB basic-auth headers and an error interceptor, which would
      // cause Keycloak admin API requests to fail with 401.
      provide: KEYCLOAK_HTTP_SERVICE,
      useFactory: () => new HttpService(axios.create({ timeout: 5000 })),
    },
    {
      provide: UserAdminService,
      useFactory: (httpService: HttpService, configService: ConfigService) =>
        new KeycloakUserAdminService(httpService, configService),
      inject: [KEYCLOAK_HTTP_SERVICE, ConfigService],
    },
  ],
  exports: [RulesService, PermissionService],
})
export class PermissionModule {}
