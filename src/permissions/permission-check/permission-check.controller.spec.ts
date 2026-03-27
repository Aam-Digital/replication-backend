import {
  BadGatewayException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios';
import { of } from 'rxjs';
import { authGuardMockProviders } from '../../auth/auth-guard-mock.providers';
import { BasicAuthGuard } from '../../auth/guards/basic-auth/basic-auth.guard';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';
import { PermissionService } from '../permission/permission.service';
import { UserIdentityService } from '../user-identity/user-identity.service';
import { PermissionCheckController } from './permission-check.controller';

describe('PermissionCheckController', () => {
  let controller: PermissionCheckController;
  let mockUserIdentityService: UserIdentityService;
  let mockPermissionService: PermissionService;
  let mockCouchdbService: CouchdbService;

  beforeEach(async () => {
    mockUserIdentityService = {
      resolveUser: jest.fn(),
    } as any;
    mockPermissionService = {
      isAllowedTo: jest.fn(),
    } as any;
    mockCouchdbService = {
      get: jest.fn().mockReturnValue(of({ _id: 'Child:1' })),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PermissionCheckController],
      providers: [
        ...authGuardMockProviders,
        { provide: BasicAuthGuard, useValue: {} },
        { provide: UserIdentityService, useValue: mockUserIdentityService },
        { provide: PermissionService, useValue: mockPermissionService },
        { provide: CouchdbService, useValue: mockCouchdbService },
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
      entityId: 'Child:1',
      action: 'read',
    });

    expect(mockCouchdbService.get).toHaveBeenCalledWith('app', 'Child:1');
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
      entityId: 'Child:1',
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
      entityId: 'Child:1',
      action: 'read',
    });

    expect(result).toEqual({ u1: { permitted: false, error: 'NOT_FOUND' } });
  });

  it('should return NOT_FOUND when user lookup throws HttpException 404', async () => {
    jest
      .spyOn(mockUserIdentityService, 'resolveUser')
      .mockRejectedValue(new HttpException('User not found', 404));

    const result = await controller.checkPermissions({
      userIds: ['u1'],
      entityId: 'Child:1',
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
        entityId: 'Child:1',
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
        entityId: 'Child:1',
        action: 'read',
      }),
    ).rejects.toThrow(BadGatewayException);
  });

  it('should throw BadRequestException for malformed userIds', async () => {
    await expect(
      controller.checkPermissions({
        userIds: 'u1' as any,
        entityId: 'Child:1',
        action: 'read',
      }),
    ).rejects.toThrow('userIds is required');
  });

  it('should throw BadRequestException for invalid action', async () => {
    await expect(
      controller.checkPermissions({
        userIds: ['u1'],
        entityId: 'Child:1',
        action: 'approve' as any,
      }),
    ).rejects.toThrow('action is invalid');
  });

  it('should throw BadRequestException when entity document is not found', async () => {
    jest.spyOn(mockCouchdbService, 'get').mockReturnValue({
      subscribe: (observer) => {
        observer.error(new HttpException('not found', 404));
      },
    } as any);

    await expect(
      controller.checkPermissions({
        userIds: ['u1'],
        entityId: 'Child:doesnotexist',
        action: 'read',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
