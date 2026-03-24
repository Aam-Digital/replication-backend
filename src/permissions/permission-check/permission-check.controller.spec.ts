import { BadGatewayException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios';
import { authGuardMockProviders } from '../../auth/auth-guard-mock.providers';
import { CombinedAuthGuard } from '../../auth/guards/combined-auth/combined-auth.guard';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';
import { PermissionService } from '../permission/permission.service';
import { UserIdentityService } from '../user-identity/user-identity.service';
import { PermissionCheckController } from './permission-check.controller';

describe('PermissionCheckController', () => {
  let controller: PermissionCheckController;
  let mockUserIdentityService: UserIdentityService;
  let mockPermissionService: PermissionService;

  beforeEach(async () => {
    mockUserIdentityService = {
      resolveUser: jest.fn(),
    } as any;
    mockPermissionService = {
      isAllowedTo: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PermissionCheckController],
      providers: [
        ...authGuardMockProviders,
        { provide: CombinedAuthGuard, useValue: {} },
        { provide: UserIdentityService, useValue: mockUserIdentityService },
        { provide: PermissionService, useValue: mockPermissionService },
      ],
    }).compile();

    controller = module.get(PermissionCheckController);
  });

  it('should return permission map for all users', async () => {
    jest
      .spyOn(mockUserIdentityService, 'resolveUser')
      .mockResolvedValueOnce(new UserInfo('u1', 'User:john', ['user_app']))
      .mockResolvedValueOnce(new UserInfo('u2', 'User:jane', ['admin_app']));

    jest
      .spyOn(mockPermissionService, 'isAllowedTo')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const result = await controller.checkPermissions({
      userIds: ['u1', 'u2'],
      entityDoc: { _id: 'Child:1' },
      action: 'read',
    });

    expect(result).toEqual({
      u1: { permitted: true },
      u2: { permitted: false },
    });
  });

  it('should return error ERROR when lookup fails with unexpected error', async () => {
    jest
      .spyOn(mockUserIdentityService, 'resolveUser')
      .mockRejectedValue(new Error('lookup failed'));

    const result = await controller.checkPermissions({
      userIds: ['u1'],
      entityDoc: { _id: 'Child:1' },
      action: 'read',
    });

    expect(result).toEqual({ u1: { permitted: false, error: 'ERROR' } });
  });

  it('should return error NOT_FOUND when Keycloak returns 404', async () => {
    const axiosResponse = {
      status: 404,
      statusText: 'Not Found',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: {},
    } as AxiosResponse;
    const notFoundError = new AxiosError(
      'Not Found',
      '404',
      undefined,
      undefined,
      axiosResponse,
    );

    jest
      .spyOn(mockUserIdentityService, 'resolveUser')
      .mockRejectedValue(notFoundError);

    const result = await controller.checkPermissions({
      userIds: ['u1'],
      entityDoc: { _id: 'Child:1' },
      action: 'read',
    });

    expect(result).toEqual({ u1: { permitted: false, error: 'NOT_FOUND' } });
  });

  it('should throw BadGatewayException when Keycloak is unreachable', async () => {
    const networkError = new AxiosError('connect ECONNREFUSED', 'ECONNREFUSED');

    jest
      .spyOn(mockUserIdentityService, 'resolveUser')
      .mockRejectedValue(networkError);

    await expect(
      controller.checkPermissions({
        userIds: ['u1'],
        entityDoc: { _id: 'Child:1' },
        action: 'read',
      }),
    ).rejects.toThrow(BadGatewayException);
  });

  it('should throw BadGatewayException when Keycloak returns 500', async () => {
    const axiosResponse = {
      status: 500,
      statusText: 'Internal Server Error',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: {},
    } as AxiosResponse;
    const serverError = new AxiosError(
      'Internal Server Error',
      '500',
      undefined,
      undefined,
      axiosResponse,
    );

    jest
      .spyOn(mockUserIdentityService, 'resolveUser')
      .mockRejectedValue(serverError);

    await expect(
      controller.checkPermissions({
        userIds: ['u1'],
        entityDoc: { _id: 'Child:1' },
        action: 'read',
      }),
    ).rejects.toThrow(BadGatewayException);
  });
});
