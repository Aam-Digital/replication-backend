import { Test, TestingModule } from '@nestjs/testing';
import { PermissionService } from './permission.service';
import { DocumentRule, RulesService } from '../rules/rules.service';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';
import { DatabaseDocument } from '../../restricted-endpoints/replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { of } from 'rxjs';

describe('PermissionService', () => {
  let service: PermissionService;
  let mockRulesService: RulesService;
  let mockCouchDBService: CouchdbService;
  let normalUser: UserInfo;

  beforeEach(async () => {
    mockRulesService = {
      getRulesForUser: () => undefined,
    } as any;
    mockCouchDBService = {
      get: () => of({}),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionService,
        { provide: RulesService, useValue: mockRulesService },
        { provide: CouchdbService, useValue: mockCouchDBService },
      ],
    }).compile();

    service = module.get<PermissionService>(PermissionService);

    normalUser = new UserInfo('user-id', 'normalUser', ['user_app']);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a ability with the received rules', () => {
    const rules: DocumentRule[] = [
      { action: 'create', subject: 'Aser' },
      { action: 'manage', subject: 'Note', inverted: true },
    ];
    jest.spyOn(mockRulesService, 'getRulesForUser').mockReturnValue(rules);

    const ability = service.getAbilityFor(normalUser);

    expect(ability.rules).toBe(rules);
  });

  it('should return ability that allows to create Aser objects if user has permissions', () => {
    jest
      .spyOn(mockRulesService, 'getRulesForUser')
      .mockReturnValue([{ action: 'create', subject: 'Aser' }]);

    const ability = service.getAbilityFor(normalUser);

    const aserDoc: DatabaseDocument = { _id: 'Aser:someId', _rev: 'someRev' };
    expect(ability.can('create', aserDoc)).toBe(true);
  });

  it('should return ability that rejects creation of Aser objects if user does not have enough permissions', () => {
    jest
      .spyOn(mockRulesService, 'getRulesForUser')
      .mockReturnValue([{ action: 'read', subject: 'Aser' }]);

    const ability = service.getAbilityFor(normalUser);

    const aserDoc: DatabaseDocument = {
      _id: 'Aser:anotherDoc',
      _rev: 'anotherRev',
    };
    expect(ability.cannot('create', aserDoc)).toBe(true);
  });

  it('should return ability that allows to read Aser and edit Child objects if user has permissions that allow it', () => {
    jest.spyOn(mockRulesService, 'getRulesForUser').mockReturnValue([
      { action: 'manage', subject: 'Child' },
      { action: 'read', subject: 'Aser' },
    ]);

    const ability = service.getAbilityFor(normalUser);

    const aserDoc: DatabaseDocument = { _id: 'Aser:someAser', _rev: 'AserRev' };
    expect(ability.can('read', aserDoc)).toBe(true);

    const childDoc: DatabaseDocument = {
      _id: 'Child:someChild',
      _rev: 'ChildRev',
    };
    expect(ability.can('update', childDoc)).toBe(true);
    expect(ability.can('read', childDoc)).toBe(true);
  });

  it('should confirm isAllowedTo to read a document if the user has the right permissions', async () => {
    jest
      .spyOn(mockRulesService, 'getRulesForUser')
      .mockReturnValue([{ action: 'read', subject: 'Aser' }]);

    const aserDoc: DatabaseDocument = { _id: 'Aser:someId', _rev: 'someRev' };

    const result = await service.isAllowedTo('read', aserDoc, normalUser, 'db');
    expect(result).toBe(true);
  });

  it('should deny isAllowedTo to read a document if the user has wrong permissions', async () => {
    jest
      .spyOn(mockRulesService, 'getRulesForUser')
      .mockReturnValue([{ action: 'read', subject: 'Child' }]);

    const aserDoc: DatabaseDocument = { _id: 'Aser:someId', _rev: 'someRev' };

    const result = await service.isAllowedTo('read', aserDoc, normalUser, 'db');
    expect(result).toBe(false);
  });

  it('should return isAllowedTo to for app-attachment based on check for the actual app entity', async () => {
    jest
      .spyOn(mockRulesService, 'getRulesForUser')
      .mockReturnValue([
        { action: 'read', subject: 'Aser', conditions: { x: true } },
      ]);

    const allowedEntityDoc: DatabaseDocument = {
      _id: 'Aser:someId',
      _rev: 'someRev',
      x: true,
    };
    jest.spyOn(mockCouchDBService, 'get').mockReturnValue(of(allowedEntityDoc));

    const attachmentDoc: DatabaseDocument = {
      _id: 'Aser:someId',
      _rev: 'attRev',
    };

    const result = await service.isAllowedTo(
      'read',
      attachmentDoc,
      normalUser,
      'app-attachments',
    );
    expect(result).toBe(true);
    expect(mockCouchDBService.get).toHaveBeenCalledWith(
      'app',
      attachmentDoc._id,
    );

    const deniedEntityDoc: DatabaseDocument = {
      _id: 'Aser:someId',
      _rev: 'someRev',
      x: false,
    };
    jest.spyOn(mockCouchDBService, 'get').mockReturnValue(of(deniedEntityDoc));
    const result2 = await service.isAllowedTo(
      'read',
      attachmentDoc,
      normalUser,
      'app-attachments',
    );
    expect(result2).toBe(false);
  });

  it('should return isAllowedTo to for app-attachment based "update" action for entity', async () => {
    jest
      .spyOn(mockRulesService, 'getRulesForUser')
      .mockReturnValue([{ action: 'update', subject: 'Aser' }]);

    const entityDoc: DatabaseDocument = {
      _id: 'Aser:someId',
      _rev: 'someRev',
    };
    jest.spyOn(mockCouchDBService, 'get').mockReturnValue(of(entityDoc));

    const attachmentDoc: DatabaseDocument = {
      _id: 'Aser:someId',
      _rev: 'attRev',
    };

    const result = await service.isAllowedTo(
      'create',
      attachmentDoc,
      normalUser,
      'app-attachments',
    );
    expect(result).toBe(true);
    expect(mockCouchDBService.get).toHaveBeenCalledWith(
      'app',
      attachmentDoc._id,
    );
  });
});
