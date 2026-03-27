import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { KeycloakUserAdminService } from './keycloak-user-admin.service';

describe('KeycloakUserAdminService', () => {
  let service: KeycloakUserAdminService;
  let mockHttpService: HttpService;

  const config = {
    [KeycloakUserAdminService.ENV_KEYCLOAK_ADMIN_BASE_URL]:
      'https://keycloak.local',
    [KeycloakUserAdminService.ENV_KEYCLOAK_REALM]: 'aam-digital',
    [KeycloakUserAdminService.ENV_KEYCLOAK_ADMIN_CLIENT_ID]:
      'replication-backend',
    [KeycloakUserAdminService.ENV_KEYCLOAK_ADMIN_CLIENT_SECRET]: 'secret',
  };

  beforeEach(async () => {
    mockHttpService = {
      post: jest.fn(),
      get: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeycloakUserAdminService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: new ConfigService(config) },
      ],
    }).compile();

    service = module.get(KeycloakUserAdminService);
  });

  function mockTokenResponse() {
    jest
      .spyOn(mockHttpService, 'post')
      .mockReturnValue(
        of({ data: { access_token: 'token', expires_in: 60 } } as any),
      );
  }

  function mockGetByEndpoint(responses: Record<string, unknown>) {
    const getSpy = jest.spyOn(mockHttpService, 'get');
    getSpy.mockImplementation((url: string) => {
      const response = responses[url];
      if (!response) {
        throw new Error(`Unexpected GET endpoint in test: ${url}`);
      }
      return of({ data: response } as any);
    });
    return getSpy;
  }

  it('should resolve entity name from exact_username and roles', async () => {
    mockTokenResponse();
    const realmBase =
      `${config[KeycloakUserAdminService.ENV_KEYCLOAK_ADMIN_BASE_URL]}` +
      `/admin/realms/${config[KeycloakUserAdminService.ENV_KEYCLOAK_REALM]}`;
    const userId = 'user-1';

    mockGetByEndpoint({
      [`${realmBase}/users/${userId}`]: {
        id: userId,
        username: 'john',
        attributes: { exact_username: ['User:john'] },
      },
      [`${realmBase}/users/${userId}/role-mappings/realm`]: [
        { name: 'user_app' },
      ],
    });

    const result = await service.getUserAccount(userId);

    expect(result.id).toBe('user-1');
    expect(result.name).toBe('User:john');
    expect(result.roles).toEqual(['user_app']);
  });

  it('should cache keycloak access token between calls', async () => {
    mockTokenResponse();
    const realmBase =
      `${config[KeycloakUserAdminService.ENV_KEYCLOAK_ADMIN_BASE_URL]}` +
      `/admin/realms/${config[KeycloakUserAdminService.ENV_KEYCLOAK_REALM]}`;

    const getSpy = mockGetByEndpoint({
      [`${realmBase}/users/user-1`]: {
        id: 'user-1',
        username: 'john',
        attributes: {},
      },
      [`${realmBase}/users/user-1/role-mappings/realm`]: [{ name: 'user_app' }],
      [`${realmBase}/users/user-2`]: {
        id: 'user-2',
        username: 'jane',
        attributes: {},
      },
      [`${realmBase}/users/user-2/role-mappings/realm`]: [
        { name: 'admin_app' },
      ],
    });

    await service.getUserAccount('user-1');
    await service.getUserAccount('user-2');

    expect(mockHttpService.post).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledTimes(4);
  });

  it('should fallback to derived User entity id when exact_username is missing', async () => {
    mockTokenResponse();
    const realmBase =
      `${config[KeycloakUserAdminService.ENV_KEYCLOAK_ADMIN_BASE_URL]}` +
      `/admin/realms/${config[KeycloakUserAdminService.ENV_KEYCLOAK_REALM]}`;
    const userId = 'user-1';

    mockGetByEndpoint({
      [`${realmBase}/users/${userId}`]: {
        id: userId,
        username: 'john',
        attributes: {},
      },
      [`${realmBase}/users/${userId}/role-mappings/realm`]: [
        { name: 'user_app' },
      ],
    });

    const result = await service.getUserAccount(userId);

    expect(result.name).toBe('User:john');
  });

  it('should fail gracefully when required keycloak config is missing', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeycloakUserAdminService,
        { provide: HttpService, useValue: mockHttpService },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            [KeycloakUserAdminService.ENV_KEYCLOAK_REALM]: 'aam-digital',
          }),
        },
      ],
    }).compile();

    const serviceWithMissingConfig = module.get(KeycloakUserAdminService);

    await expect(
      serviceWithMissingConfig.getUserAccount('user-1'),
    ).rejects.toThrow(
      `Missing required config: ${KeycloakUserAdminService.ENV_KEYCLOAK_ADMIN_BASE_URL}`,
    );
  });
});
