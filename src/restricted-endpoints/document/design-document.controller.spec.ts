import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { authGuardMockProviders } from '../../auth/auth-guard-mock.providers';
import { CouchdbService } from '../../couchdb/couchdb.service';
import {
  detectDocumentType,
  DocumentAbility,
  PermissionService,
} from '../../permissions/permission/permission.service';
import { DocSuccess } from '../replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import { UserInfo } from '../session/user-auth.dto';
import { DesignDocumentController } from './design-document.controller';

describe('DesignDocumentController', () => {
  let controller: DesignDocumentController;
  let mockCouchDBService: CouchdbService;
  let mockPermissionService: PermissionService;

  const requestingUser: UserInfo = new UserInfo('user-id', 'testUser', []);
  const databaseName = 'app';

  const designDoc = {
    _id: '_design/search_index',
    _rev: '1-abc',
    views: {
      by_name: {
        map: '(doc) => { emit(doc.name); }',
      },
    },
  };

  const SUCCESS_RESPONSE: DocSuccess = {
    ok: true,
    id: designDoc._id,
    rev: designDoc._rev,
  };

  const viewResult = {
    total_rows: 3,
    offset: 0,
    rows: [
      {
        id: 'Child:1',
        key: 'Alice',
        value: null,
        doc: { _id: 'Child:1', name: 'Alice' },
      },
      {
        id: 'Child:2',
        key: 'Bob',
        value: null,
        doc: { _id: 'Child:2', name: 'Bob' },
      },
      {
        id: 'Child:3',
        key: 'Charlie',
        value: null,
        doc: { _id: 'Child:3', name: 'Charlie', _deleted: true },
      },
    ],
  };

  beforeEach(async () => {
    mockCouchDBService = {
      get: () => of({}),
      put: () => of({}),
    } as any;
    jest.spyOn(mockCouchDBService, 'get').mockReturnValue(of(designDoc));
    jest.spyOn(mockCouchDBService, 'put').mockReturnValue(of(SUCCESS_RESPONSE));

    mockPermissionService = {
      getAbilityFor: () => undefined,
      isAllowedTo: jest.fn(async () => true),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DesignDocumentController],
      providers: [
        ...authGuardMockProviders,
        { provide: CouchdbService, useValue: mockCouchDBService },
        { provide: PermissionService, useValue: mockPermissionService },
      ],
    }).compile();

    controller = module.get<DesignDocumentController>(DesignDocumentController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getDesignDoc', () => {
    it('should fetch the design document from CouchDB', () => {
      controller.getDesignDoc(databaseName, 'search_index', requestingUser);

      expect(mockCouchDBService.get).toHaveBeenCalledWith(
        databaseName,
        '_design/search_index',
        undefined,
      );
    });
  });

  describe('putDesignDoc', () => {
    const adminAbility = new DocumentAbility(
      [{ action: 'manage', subject: '_design' }],
      { detectSubjectType: detectDocumentType },
    );

    it('should create a design document in CouchDB', async () => {
      mockPermissionService.getAbilityFor = jest.fn(() => adminAbility);

      const result = await controller.putDesignDoc(
        databaseName,
        'search_index',
        { ...designDoc },
        requestingUser,
      );

      expect(result).toBe(SUCCESS_RESPONSE);
      expect(mockCouchDBService.put).toHaveBeenCalledWith(
        databaseName,
        expect.objectContaining({ _id: '_design/search_index' }),
      );
    });

    it('should set the _id from the URL path', async () => {
      mockPermissionService.getAbilityFor = jest.fn(() => adminAbility);
      const docWithoutId = { views: designDoc.views } as any;

      await controller.putDesignDoc(
        databaseName,
        'my_view',
        docWithoutId,
        requestingUser,
      );

      expect(mockCouchDBService.put).toHaveBeenCalledWith(
        databaseName,
        expect.objectContaining({ _id: '_design/my_view' }),
      );
    });

    it('should reject if user lacks manage permission on _design', async () => {
      const readOnlyAbility = new DocumentAbility(
        [{ action: 'read', subject: 'all' }],
        { detectSubjectType: detectDocumentType },
      );
      mockPermissionService.getAbilityFor = jest.fn(() => readOnlyAbility);

      await expect(
        controller.putDesignDoc(
          databaseName,
          'search_index',
          { ...designDoc },
          requestingUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('queryView', () => {
    it('should proxy view query to CouchDB', async () => {
      jest.spyOn(mockCouchDBService, 'get').mockReturnValue(of(viewResult));

      const result = await controller.queryView(
        databaseName,
        'search_index',
        'by_name',
        requestingUser,
        { key: '"Alice"' },
      );

      expect(mockCouchDBService.get).toHaveBeenCalledWith(
        databaseName,
        '_design/search_index/_view/by_name',
        { key: '"Alice"' },
      );
      expect(result).toBeDefined();
    });

    it('should filter rows based on user permissions when include_docs is true', async () => {
      const ability = new DocumentAbility(
        [{ action: 'read', subject: 'Child', conditions: { _id: 'Child:1' } }],
        { detectSubjectType: detectDocumentType },
      );
      mockPermissionService.getAbilityFor = jest.fn(() => ability);
      jest
        .spyOn(mockCouchDBService, 'get')
        .mockReturnValue(of(JSON.parse(JSON.stringify(viewResult))));

      const result = await controller.queryView(
        databaseName,
        'search_index',
        'by_name',
        requestingUser,
        { include_docs: 'true' },
      );

      // Child:1 is readable, Child:2 is not, Child:3 is deleted (always included)
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].id).toBe('Child:1');
      expect(result.rows[1].id).toBe('Child:3');
    });

    it('should not filter rows when include_docs is not set', async () => {
      jest
        .spyOn(mockCouchDBService, 'get')
        .mockReturnValue(of(JSON.parse(JSON.stringify(viewResult))));

      const result = await controller.queryView(
        databaseName,
        'search_index',
        'by_name',
        requestingUser,
      );

      expect(result.rows).toHaveLength(3);
    });

    it('should return all rows when user has full read access', async () => {
      const ability = new DocumentAbility([
        { action: 'manage', subject: 'all' },
      ]);
      mockPermissionService.getAbilityFor = jest.fn(() => ability);
      jest
        .spyOn(mockCouchDBService, 'get')
        .mockReturnValue(of(JSON.parse(JSON.stringify(viewResult))));

      const result = await controller.queryView(
        databaseName,
        'search_index',
        'by_name',
        requestingUser,
        { include_docs: 'true' },
      );

      expect(result.rows).toHaveLength(3);
    });

    it('should filter rows when include_docs is boolean true', async () => {
      const ability = new DocumentAbility(
        [{ action: 'read', subject: 'Child', conditions: { _id: 'Child:1' } }],
        { detectSubjectType: detectDocumentType },
      );
      mockPermissionService.getAbilityFor = jest.fn(() => ability);
      jest
        .spyOn(mockCouchDBService, 'get')
        .mockReturnValue(of(JSON.parse(JSON.stringify(viewResult))));

      const result = await controller.queryView(
        databaseName,
        'search_index',
        'by_name',
        requestingUser,
        { include_docs: true },
      );

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].id).toBe('Child:1');
      expect(result.rows[1].id).toBe('Child:3');
    });

    it('should keep deletion rows without doc and drop ambiguous rows without doc', async () => {
      const ability = new DocumentAbility(
        [{ action: 'read', subject: 'Child', conditions: { _id: 'Child:1' } }],
        { detectSubjectType: detectDocumentType },
      );
      mockPermissionService.getAbilityFor = jest.fn(() => ability);
      jest.spyOn(mockCouchDBService, 'get').mockReturnValue(
        of({
          total_rows: 4,
          offset: 0,
          rows: [
            {
              id: 'Deleted:from-view',
              key: 'Deleted:from-view',
              value: { deleted: true },
            },
            {
              id: 'Unknown:no-doc',
              key: 'Unknown:no-doc',
              value: null,
            },
            {
              id: 'Child:1',
              key: 'Child:1',
              value: null,
              doc: { _id: 'Child:1', name: 'Alice' },
            },
            {
              id: 'Child:2',
              key: 'Child:2',
              value: null,
              doc: { _id: 'Child:2', name: 'Bob' },
            },
          ],
        }),
      );

      const result = await controller.queryView(
        databaseName,
        'search_index',
        'by_name',
        requestingUser,
        { include_docs: 'true' },
      );

      expect(result.rows).toHaveLength(2);
      expect(result.rows.map((row) => row.id)).toEqual([
        'Deleted:from-view',
        'Child:1',
      ]);
    });
  });
});
