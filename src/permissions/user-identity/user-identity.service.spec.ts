import { Test, TestingModule } from '@nestjs/testing';
import { of, Subject, throwError } from 'rxjs';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { DocumentChangesService } from '../../couchdb/document-changes.service';
import { ChangeResult } from '../../restricted-endpoints/replication/bulk-document/couchdb-dtos/changes.dto';
import {
  UserAccount,
  UserInfo,
} from '../../restricted-endpoints/session/user-auth.dto';
import { UserAdminService } from './user-admin.service';
import { UserIdentityService } from './user-identity.service';

describe('UserIdentityService', () => {
  let service: UserIdentityService;
  let mockUserAdminService: UserAdminService;
  let mockCouchdbService: CouchdbService;
  let mockDocumentChangesService: Pick<DocumentChangesService, 'getChanges'>;
  let changesSubject: Subject<ChangeResult>;

  beforeEach(async () => {
    mockUserAdminService = {
      getUserAccount: jest.fn(),
    } as any;
    mockCouchdbService = {
      get: jest.fn(),
    } as any;
    changesSubject = new Subject<ChangeResult>();
    mockDocumentChangesService = {
      getChanges: jest.fn().mockReturnValue(changesSubject),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserIdentityService,
        { provide: UserAdminService, useValue: mockUserAdminService },
        { provide: CouchdbService, useValue: mockCouchdbService },
        {
          provide: DocumentChangesService,
          useValue: mockDocumentChangesService,
        },
      ],
    }).compile();

    service = module.get(UserIdentityService);
  });

  it('should resolve user info and projects', async () => {
    jest
      .spyOn(mockUserAdminService, 'getUserAccount')
      .mockResolvedValue(new UserAccount('u1', 'User:john', ['user_app']));
    jest
      .spyOn(mockCouchdbService, 'get')
      .mockReturnValue(of({ projects: ['Project:1'] }));

    const result = await service.resolveUser('u1');

    expect(mockDocumentChangesService.getChanges).toHaveBeenCalledWith('app');
    expect(result).toEqual(
      new UserInfo('u1', 'User:john', ['user_app'], ['Project:1']),
    );
  });

  it('should cache resolved users', async () => {
    jest
      .spyOn(mockUserAdminService, 'getUserAccount')
      .mockResolvedValue(new UserAccount('u1', 'User:john', ['user_app']));
    jest
      .spyOn(mockCouchdbService, 'get')
      .mockReturnValue(of({ projects: ['Project:1'] }));

    await service.resolveUser('u1');
    await service.resolveUser('u1');

    // resolveUser on admin service should only be called once (second call served from cache)
    expect(mockUserAdminService.getUserAccount).toHaveBeenCalledTimes(1);
  });

  it('should fallback to empty projects when linked user entity is not found in db', async () => {
    jest
      .spyOn(mockUserAdminService, 'getUserAccount')
      .mockResolvedValue(new UserAccount('u1', 'User:john', ['user_app']));
    jest
      .spyOn(mockCouchdbService, 'get')
      .mockReturnValue(throwError(() => new Error('not found')));

    const result = await service.resolveUser('u1');

    expect(result).toEqual(new UserInfo('u1', 'User:john', ['user_app'], []));
  });

  it('should re-fetch user after clearCache is called', async () => {
    jest
      .spyOn(mockUserAdminService, 'getUserAccount')
      .mockResolvedValue(new UserAccount('u1', 'User:john', ['user_app']));
    jest
      .spyOn(mockCouchdbService, 'get')
      .mockReturnValue(of({ projects: ['Project:1'] }));

    await service.resolveUser('u1');
    service.clearCache();
    await service.resolveUser('u1');

    expect(mockUserAdminService.getUserAccount).toHaveBeenCalledTimes(2);
  });

  it('should invalidate cached user when its entity changes in couchdb', async () => {
    // Use a non-User: prefixed entity to prove invalidation works for any entity type
    jest
      .spyOn(mockUserAdminService, 'getUserAccount')
      .mockResolvedValue(
        new UserAccount('u1', 'Participant:john', ['user_app']),
      );
    jest
      .spyOn(mockCouchdbService, 'get')
      .mockReturnValue(of({ projects: ['Project:1'] }));

    await service.resolveUser('u1');

    // Emit a change for Participant:john via the shared changes feed
    changesSubject.next({
      id: 'Participant:john',
      seq: '1',
      changes: [{ rev: '2-abc' }],
    });

    await service.resolveUser('u1');

    // Second call should re-fetch because cache was invalidated
    expect(mockUserAdminService.getUserAccount).toHaveBeenCalledTimes(2);
  });

  it('should not invalidate cache for changes to entities not linked to any cached user', async () => {
    jest
      .spyOn(mockUserAdminService, 'getUserAccount')
      .mockResolvedValue(
        new UserAccount('u1', 'Participant:john', ['user_app']),
      );
    jest
      .spyOn(mockCouchdbService, 'get')
      .mockReturnValue(of({ projects: ['Project:1'] }));

    await service.resolveUser('u1');

    // Emit a change for an entity that is not a profile entity of any cached user
    changesSubject.next({
      id: 'Child:42',
      seq: '1',
      changes: [{ rev: '2-abc' }],
    });

    await service.resolveUser('u1');

    // Should still serve from cache
    expect(mockUserAdminService.getUserAccount).toHaveBeenCalledTimes(1);
  });
});
