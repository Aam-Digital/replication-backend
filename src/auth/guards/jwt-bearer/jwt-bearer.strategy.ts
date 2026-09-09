import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { passportJwtSecret } from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { firstValueFrom } from 'rxjs';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { UserInfo } from '../../../restricted-endpoints/session/user-auth.dto';
import { KeycloakUserAdminService } from '../../../permissions/user-identity/keycloak-user-admin.service';
import { BearerJwtPayload } from '../../jwt-payload.types';

/**
 * Authenticate a user with a foreign bearer JWT, verifying its signature
 * against the issuing Keycloak realm's JWKS instead of a static, deployment-
 * pinned public key.
 *
 * This needs no configuration beyond what {@link KeycloakUserAdminService}
 * already requires: {@link KeycloakUserAdminService.ENV_KEYCLOAK_ADMIN_BASE_URL}
 * and {@link KeycloakUserAdminService.ENV_KEYCLOAK_REALM}. Resolving the key
 * dynamically means a realm signing-key rotation (manual rotation, a realm
 * re-import, a key-provider change) no longer breaks every login and sync
 * with an unexplained 401 until someone redeploys with a new static key -
 * Keycloak serves the old and new keys side by side during a rotation, so
 * this keeps validating tokens signed with either.
 */
@Injectable()
export class JwtBearerStrategy extends PassportStrategy(
  Strategy,
  'jwt-bearer',
) {
  constructor(
    configService: ConfigService,
    private couchdbService: CouchdbService,
  ) {
    const keycloakBaseUrl = JwtBearerStrategy.readRequiredConfig(
      configService,
      KeycloakUserAdminService.ENV_KEYCLOAK_ADMIN_BASE_URL,
    ).replace(/\/$/, '');
    const realm = JwtBearerStrategy.readRequiredConfig(
      configService,
      KeycloakUserAdminService.ENV_KEYCLOAK_REALM,
    );
    const issuer = `${keycloakBaseUrl}/realms/${realm}`;

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // a token from a different realm on the same Keycloak server must not
      // validate just because it happens to be signed by a key this realm's
      // JWKS also lists (Keycloak realms do not share signing keys, but this
      // is the option that would catch it if that ever changed)
      issuer,
      algorithms: ['RS256'],
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${issuer}/protocol/openid-connect/certs`,
      }),
    });
  }

  private static readRequiredConfig(
    configService: ConfigService,
    key: string,
  ): string {
    const value = configService.get<string>(key);
    if (!value) {
      throw new Error(
        `Missing required config "${key}" for JWT bearer verification (needed to resolve the Keycloak realm's JWKS)`,
      );
    }
    return value;
  }

  async validate(data: BearerJwtPayload): Promise<UserInfo> {
    const user = await firstValueFrom(
      this.couchdbService.get('app', data.username),
    ).catch(() => {});
    const projects = Array.isArray(user?.projects)
      ? user.projects.filter(
          (project): project is string => typeof project === 'string',
        )
      : [];

    return new UserInfo(
      data.sub,
      data.username,
      data['_couchdb.roles'],
      projects,
    );
  }
}
