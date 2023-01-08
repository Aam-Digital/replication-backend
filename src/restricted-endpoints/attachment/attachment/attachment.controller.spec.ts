import { Test, TestingModule } from '@nestjs/testing';
import { AttachmentController } from './attachment.controller';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { PermissionService } from '../../../permissions/permission/permission.service';
import { of } from 'rxjs';
import { Ability } from '@casl/ability';
import { authGuardMockProviders } from '../../../auth/auth-guard-mock.providers';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserInfo } from '../../session/user-auth.dto';
import { RestrictedEndpointsModule } from '../../restricted-endpoints.module';

describe('AttachmentController', () => {
  let controller: AttachmentController;
  let mockCouchDB: CouchdbService;
  let mockPermissions: PermissionService;

  beforeEach(async () => {
    mockCouchDB = { get: () => of(undefined) } as any;
    mockPermissions = { getAbilityFor: () => undefined } as any;
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttachmentController],
      providers: [
        ...authGuardMockProviders,
        { provide: CouchdbService, useValue: mockCouchDB },
        { provide: PermissionService, useValue: mockPermissions },
      ],
    }).compile();

    controller = module.get<AttachmentController>(AttachmentController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should throw UnauthorizedException if user is not logged in and not permitted', () => {
    jest.spyOn(mockPermissions, 'getAbilityFor').mockReturnValue(new Ability());

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
    jest.spyOn(mockPermissions, 'getAbilityFor').mockReturnValue(new Ability());

    return expect(
      controller.createAttachment(
        'db',
        'docId',
        'prop',
        { rev: '1' },
        new UserInfo('user', []),
        undefined,
        undefined,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should upload document if user is permitted', async () => {
    jest
      .spyOn(mockPermissions, 'getAbilityFor')
      .mockReturnValue(new Ability([{ subject: 'all', action: 'manage' }]));
    RestrictedEndpointsModule.proxy = () => undefined;
    jest.spyOn(RestrictedEndpointsModule, 'proxy');

    await controller.createAttachment(
      'db',
      'docId',
      'prop',
      { rev: '1' },
      new UserInfo('user', []),
      undefined,
      undefined,
    );

    expect(RestrictedEndpointsModule.proxy).toHaveBeenCalled();
    RestrictedEndpointsModule.proxy = undefined;
  });

  it('should throw ForbiddenException if user is not permitted', () => {
    jest
      .spyOn(mockPermissions, 'getAbilityFor')
      .mockReturnValue(new Ability([{ subject: 'all', action: 'update' }]));

    return expect(
      controller.getAttachment(
        'db',
        'docId',
        'prop',
        new UserInfo('user', []),
        undefined,
        undefined,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should call proxy if user is permitted', async () => {
    jest
      .spyOn(mockPermissions, 'getAbilityFor')
      .mockReturnValue(new Ability([{ subject: 'all', action: 'read' }]));
    RestrictedEndpointsModule.proxy = () => undefined;
    jest.spyOn(RestrictedEndpointsModule, 'proxy');

    await controller.getAttachment(
      'db',
      'docId',
      'prop',
      new UserInfo('user', []),
      undefined,
      undefined,
    );

    expect(RestrictedEndpointsModule.proxy).toHaveBeenCalled();
    RestrictedEndpointsModule.proxy = undefined;
  });
});
