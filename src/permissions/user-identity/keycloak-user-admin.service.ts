import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { UserAccount } from '../../restricted-endpoints/session/user-auth.dto';
import { UserAdminService } from './user-admin.service';

type KeycloakUserResponse = {
  id: string;
  username?: string;
  attributes?: {
    exact_username?: string[];
    [key: string]: string[] | undefined;
  };
};

type KeycloakRole = {
  name: string;
};

type TokenResponse = {
  access_token: string;
  expires_in: number;
};

/**
 * Keycloak-backed implementation for resolving user identity and realm roles.
 */
@Injectable()
export class KeycloakUserAdminService extends UserAdminService {
  static readonly ENV_KEYCLOAK_ADMIN_BASE_URL = 'KEYCLOAK_ADMIN_BASE_URL';
  static readonly ENV_KEYCLOAK_REALM = 'KEYCLOAK_REALM';
  static readonly ENV_KEYCLOAK_ADMIN_CLIENT_ID = 'KEYCLOAK_ADMIN_CLIENT_ID';
  static readonly ENV_KEYCLOAK_ADMIN_CLIENT_SECRET =
    'KEYCLOAK_ADMIN_CLIENT_SECRET';

  private readonly logger = new Logger(KeycloakUserAdminService.name);
  private tokenCache: { token: string; expiresAtMs: number } | undefined;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  /**
   * Fetches user account id, linked entity id (or fallback), and roles from Keycloak.
   */
  async getUserAccount(userId: string): Promise<UserAccount> {
    const accessToken = await this.getAccessToken();
    const user = await this.fetchUser(userId, accessToken);
    const roles = await this.fetchUserRoles(userId, accessToken);

    const entityName = this.resolveEntityName(user);
    if (!entityName) {
      throw new InternalServerErrorException(
        `Could not resolve entity name for user ${userId}`,
      );
    }

    return new UserAccount(user.id, entityName, roles);
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAtMs > now) {
      return this.tokenCache.token;
    }

    const tokenEndpoint = `${this.getKeycloakBaseUrl()}/realms/${this.getRealm()}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.getClientId(),
      client_secret: this.getClientSecret(),
    });

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.post<TokenResponse>(tokenEndpoint, body.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to obtain Keycloak access token`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }

    const token = response.data?.access_token;
    const expiresInSec = response.data?.expires_in ?? 60;
    if (!token) {
      throw new InternalServerErrorException(
        'Keycloak token response does not include access_token',
      );
    }

    const skewMs = 5_000;
    this.tokenCache = {
      token,
      expiresAtMs: now + Math.max(1, expiresInSec) * 1000 - skewMs,
    };

    return token;
  }

  private async fetchUser(
    userId: string,
    accessToken: string,
  ): Promise<KeycloakUserResponse> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<KeycloakUserResponse>(
          `${this.getRealmAdminBaseUrl()}/users/${userId}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch Keycloak user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  private async fetchUserRoles(
    userId: string,
    accessToken: string,
  ): Promise<string[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<KeycloakRole[]>(
          `${this.getRealmAdminBaseUrl()}/users/${userId}/role-mappings/realm`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        ),
      );
      return (response.data ?? []).map((role) => role.name).filter(Boolean);
    } catch (error) {
      this.logger.warn(
        `Failed to fetch roles for Keycloak user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  private resolveEntityName(user: KeycloakUserResponse): string | undefined {
    const linkedEntityId = user.attributes?.exact_username?.[0];
    if (linkedEntityId) {
      return linkedEntityId;
    }

    // Fallback for accounts without the custom exact_username mapper.
    // We keep backward compatibility by deriving the standard User entity id.
    if (!user.username) {
      return undefined;
    }

    return user.username.includes(':')
      ? user.username
      : `User:${user.username}`;
  }

  private getRealmAdminBaseUrl(): string {
    return `${this.getKeycloakBaseUrl()}/admin/realms/${this.getRealm()}`;
  }

  private getKeycloakBaseUrl(): string {
    return this.readRequiredConfig(
      KeycloakUserAdminService.ENV_KEYCLOAK_ADMIN_BASE_URL,
    ).replace(/\/$/, '');
  }

  private getRealm(): string {
    return this.readRequiredConfig(KeycloakUserAdminService.ENV_KEYCLOAK_REALM);
  }

  private getClientId(): string {
    return this.readRequiredConfig(
      KeycloakUserAdminService.ENV_KEYCLOAK_ADMIN_CLIENT_ID,
    );
  }

  private getClientSecret(): string {
    return this.readRequiredConfig(
      KeycloakUserAdminService.ENV_KEYCLOAK_ADMIN_CLIENT_SECRET,
    );
  }

  private readRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new InternalServerErrorException(`Missing required config: ${key}`);
    }
    return value;
  }
}
