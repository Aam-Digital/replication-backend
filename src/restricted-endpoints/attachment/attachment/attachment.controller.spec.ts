import { Test, TestingModule } from '@nestjs/testing';
import { AttachmentController } from './attachment.controller';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import {
  DocumentAbility,
  PermissionService,
} from '../../../permissions/permission/permission.service';
import { of } from 'rxjs';
import { authGuardMockProviders } from '../../../auth/auth-guard-mock.providers';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserInfo } from '../../session/user-auth.dto';
import { ConfigService } from '@nestjs/config';

describe('AttachmentController', () => {
  let controller: AttachmentController;
  let mockCouchDB: CouchdbService;
  let mockPermissions: PermissionService;

  let user: UserInfo;

  beforeEach(async () => {
    user = new UserInfo('user-id', 'user', []);

    mockCouchDB = {
      get: () => of(undefined),
      delete: () => of(undefined),
    } as any;
    mockPermissions = {
      isAllowedTo: jest.fn(),
    } as any;
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttachmentController],
      providers: [
        ...authGuardMockProviders,
        { provide: CouchdbService, useValue: mockCouchDB },
        { provide: PermissionService, useValue: mockPermissions },
        { provide: ConfigService, useValue: { get: () => 'test' } },
      ],
    }).compile();

    controller = module.get<AttachmentController>(AttachmentController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should throw UnauthorizedException if user is not logged in and not permitted', () => {
    jest.spyOn(mockPermissions, 'isAllowedTo').mockResolvedValue(false);

    return expect(
      controller.createAttachment(
        'db',
        'docId',
        'prop',
        { rev: '1' },
        undefined,
        undefined,
        undefined,
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should throw ForbiddenException if user is authenticated but not permitted', () => {
    jest.spyOn(mockPermissions, 'isAllowedTo').mockResolvedValue(false);

    return expect(
      controller.createAttachment(
        'db',
        'docId',
        'prop',
        { rev: '1' },
        user,
        undefined,
        undefined,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should upload document if user is permitted', async () => {
    jest.spyOn(mockPermissions, 'isAllowedTo').mockResolvedValue(true);
    (controller.proxy as any) = () => undefined;
    jest.spyOn(controller, 'proxy');

    await controller.createAttachment(
      'db',
      'docId',
      'prop',
      { rev: '1' },
      user,
      undefined,
      undefined,
    );

    expect(controller.proxy).toHaveBeenCalled();
    controller.proxy = undefined;
  });

  it('should throw ForbiddenException if user is not permitted to view attachment', () => {
    jest.spyOn(mockPermissions, 'isAllowedTo').mockResolvedValue(false);

    return expect(
      controller.getAttachment(
        'db',
        'docId',
        'prop',
        user,
        undefined,
        undefined,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should call proxy if user is permitted to download attachment', async () => {
    jest.spyOn(mockPermissions, 'isAllowedTo').mockResolvedValue(true);
    (controller.proxy as any) = () => undefined;
    jest.spyOn(controller, 'proxy');

    await controller.getAttachment(
      'db',
      'docId',
      'prop',
      user,
      undefined,
      undefined,
    );

    expect(controller.proxy).toHaveBeenCalled();
    controller.proxy = undefined;
  });

  it('should throw ForbiddenException if user is not permitted to delete attachment', () => {
    jest.spyOn(mockPermissions, 'isAllowedTo').mockResolvedValue(false);

    return expect(
      controller.deleteAttachment(
        'db',
        'docId',
        'prop',
        { rev: '1-rev' },
        user,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should call couchDB service if user is allowed to delete', async () => {
    jest.spyOn(mockPermissions, 'isAllowedTo').mockResolvedValue(true);
    jest.spyOn(mockCouchDB, 'delete');

    await controller.deleteAttachment(
      'db',
      'docId',
      'prop',
      { rev: '1-rev' },
      user,
    );

    expect(mockCouchDB.delete).toHaveBeenCalledWith('db', 'docId/prop', {
      rev: '1-rev',
    });
  });
});
