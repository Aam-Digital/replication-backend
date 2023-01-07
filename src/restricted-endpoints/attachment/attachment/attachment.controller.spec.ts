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
    mockCouchDB = {
      putAttachment: () => of(undefined),
      get: () => of(undefined),
    } as any;
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

  it('should throw UnauthorizedException if user is not logged in and not permitted', (done) => {
    jest.spyOn(mockPermissions, 'getAbilityFor').mockReturnValue(new Ability());

    controller
      .createAttachment(
        'db',
        'docId',
        'prop',
        { rev: '1' },
        undefined,
        undefined,
      )
      .subscribe({
        error: (err) => {
          expect(err).toBeInstanceOf(UnauthorizedException);
          done();
        },
      });
  });

  it('should throw ForbiddenException if user is authenticated but not permitted', (done) => {
    jest.spyOn(mockPermissions, 'getAbilityFor').mockReturnValue(new Ability());

    controller
      .createAttachment(
        'db',
        'docId',
        'prop',
        { rev: '1' },
        new UserInfo('user', []),
        undefined,
      )
      .subscribe({
        error: (err) => {
          expect(err).toBeInstanceOf(ForbiddenException);
          done();
        },
      });
  });

  it('should upload document if user is permitted', (done) => {
    jest
      .spyOn(mockPermissions, 'getAbilityFor')
      .mockReturnValue(new Ability([{ subject: 'all', action: 'manage' }]));
    jest.spyOn(mockCouchDB, 'putAttachment').mockReturnValue(of(undefined));
    const body = Buffer.alloc(2);
    const request = {
      on: (_, fun) => setTimeout(() => fun(body)),
      headers: { 'content-type': 'application/pdf' },
    };
    controller
      .createAttachment(
        'db',
        'docId',
        'prop',
        { rev: '1' },
        new UserInfo('user', []),
        request as any,
      )
      .subscribe(() => {
        expect(mockCouchDB.putAttachment).toHaveBeenCalledWith(
          'db',
          `docId/prop`,
          Buffer.concat([body]),
          {
            params: { rev: '1' },
            headers: { 'content-type': 'application/pdf' },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
          },
        );
        done();
      });
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

    await expect(
      controller.getAttachment(
        'db',
        'docId',
        'prop',
        new UserInfo('user', []),
        undefined,
        undefined,
      ),
    ).resolves;

    expect(RestrictedEndpointsModule.proxy).toHaveBeenCalled();
    RestrictedEndpointsModule.proxy = undefined;
  });
});
