import { Test, TestingModule } from '@nestjs/testing';
import { PermissionService } from './permission.service';
import { DocumentRule, RulesService } from '../rules/rules.service';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';
import { DatabaseDocument } from '../../restricted-endpoints/replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { of, Subject } from 'rxjs';

describe('PermissionService', () => {
  let service: PermissionService;
  let mockRulesService: RulesService;
  let mockCouchDBService: CouchdbService;
  let permissionsChanged: Subject<void>;
  let normalUser: UserInfo;

  beforeEach(async () => {
    permissionsChanged = new Subject<void>();
    mockRulesService = {
      getRulesForUser: () => undefined,
      permissionsChanged$: permissionsChanged.asObservable(),
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

    // the rules are validated before being handed to CASL, so this is a new
    // array carrying the same rules rather than the caller's array itself
    expect(ability.rules).toEqual(rules);
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

  describe('ability caching', () => {
    it('should reuse the cached ability for repeated calls with the same user', () => {
      const getRulesSpy = jest
        .spyOn(mockRulesService, 'getRulesForUser')
        .mockReturnValue([{ action: 'read', subject: 'Aser' }]);

      const first = service.getAbilityFor(normalUser);
      const second = service.getAbilityFor(normalUser);

      expect(second).toBe(first);
      expect(getRulesSpy).toHaveBeenCalledTimes(1);
    });

    it('should build separate abilities for different users', () => {
      const getRulesSpy = jest
        .spyOn(mockRulesService, 'getRulesForUser')
        .mockReturnValue([{ action: 'read', subject: 'Aser' }]);
      const otherUser = new UserInfo('other-id', 'otherUser', ['user_app']);

      const first = service.getAbilityFor(normalUser);
      const second = service.getAbilityFor(otherUser);

      expect(second).not.toBe(first);
      expect(getRulesSpy).toHaveBeenCalledTimes(2);
    });

    it('should rebuild the ability when the permission config changed', () => {
      const getRulesSpy = jest
        .spyOn(mockRulesService, 'getRulesForUser')
        .mockReturnValue([{ action: 'read', subject: 'Aser' }]);

      const first = service.getAbilityFor(normalUser);
      permissionsChanged.next();
      const second = service.getAbilityFor(normalUser);

      expect(second).not.toBe(first);
      expect(getRulesSpy).toHaveBeenCalledTimes(2);
    });

    it('should discard cached abilities of all users on a config change', () => {
      jest
        .spyOn(mockRulesService, 'getRulesForUser')
        .mockReturnValue([{ action: 'read', subject: 'Aser' }]);
      const otherUser = new UserInfo('other-id', 'otherUser', ['user_app']);

      const first = service.getAbilityFor(normalUser);
      const firstOther = service.getAbilityFor(otherUser);
      permissionsChanged.next();

      expect(service.getAbilityFor(normalUser)).not.toBe(first);
      expect(service.getAbilityFor(otherUser)).not.toBe(firstOther);
    });

    it('should cache the anonymous (public) ability separately from users', () => {
      const getRulesSpy = jest
        .spyOn(mockRulesService, 'getRulesForUser')
        .mockReturnValue([{ action: 'read', subject: 'Aser' }]);

      const anonymous = service.getAbilityFor(undefined as any);
      const second = service.getAbilityFor(undefined as any);
      const userAbility = service.getAbilityFor(normalUser);

      expect(second).toBe(anonymous);
      expect(userAbility).not.toBe(anonymous);
      expect(getRulesSpy).toHaveBeenCalledTimes(2);
    });
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
  describe('logical operators in conditions', () => {
    const childInCenter1: DatabaseDocument = {
      _id: 'Child:1',
      _rev: 'rev',
      center: 'center-1',
      assignedTo: 'User:someone-else',
      age: 10,
    } as DatabaseDocument;

    const abilityWithConditions = (conditions: Record<string, any>) => {
      jest
        .spyOn(mockRulesService, 'getRulesForUser')
        .mockReturnValue([{ action: 'read', subject: 'Child', conditions }]);
      return service.getAbilityFor(normalUser);
    };

    it('should allow access if one branch of a $or condition matches', () => {
      const ability = abilityWithConditions({
        $or: [{ center: 'center-1' }, { assignedTo: 'User:normalUser' }],
      });

      expect(ability.can('read', childInCenter1)).toBe(true);
    });

    it('should deny access if no branch of a $or condition matches', () => {
      const ability = abilityWithConditions({
        $or: [{ center: 'center-2' }, { assignedTo: 'User:normalUser' }],
      });

      expect(ability.can('read', childInCenter1)).toBe(false);
    });

    it('should evaluate a $and condition restricting the same field twice', () => {
      const ability = abilityWithConditions({
        $and: [{ age: { $gt: 5 } }, { age: { $lt: 18 } }],
      });

      expect(ability.can('read', childInCenter1)).toBe(true);
    });

    it('should deny access if one part of a $and condition does not match', () => {
      const ability = abilityWithConditions({
        $and: [{ age: { $gt: 50 } }, { age: { $lt: 18 } }],
      });

      expect(ability.can('read', childInCenter1)).toBe(false);
    });

    it('should evaluate a $not condition', () => {
      const ability = abilityWithConditions({
        center: { $not: { $eq: 'center-2' } },
      });

      expect(ability.can('read', childInCenter1)).toBe(true);
    });

    it('should evaluate a $nor condition', () => {
      const ability = abilityWithConditions({ $nor: [{ center: 'center-2' }] });

      expect(ability.can('read', childInCenter1)).toBe(true);
    });

    it('should combine a $or with a sibling condition as an implicit and', () => {
      const ability = abilityWithConditions({
        assignedTo: 'User:someone-else',
        $or: [{ center: 'center-1' }, { center: 'center-2' }],
      });

      expect(ability.can('read', childInCenter1)).toBe(true);
    });

    it('should still evaluate plain field operators', () => {
      const ability = abilityWithConditions({ center: { $in: ['center-1'] } });

      expect(ability.can('read', childInCenter1)).toBe(true);
      expect(
        ability.can('read', { ...childInCenter1, center: 'center-2' }),
      ).toBe(false);
    });
  });
  describe('unusable conditions', () => {
    const child: DatabaseDocument = {
      _id: 'Child:1',
      _rev: 'rev',
      center: 'center-1',
    } as DatabaseDocument;

    const abilityForRules = (rules: any[]) => {
      jest.spyOn(mockRulesService, 'getRulesForUser').mockReturnValue(rules);
      return service.getAbilityFor(normalUser);
    };

    it('should deny rather than throw for an empty logical array', () => {
      const ability = abilityForRules([
        { action: 'read', subject: 'Child', conditions: { $or: [] } },
      ]);

      expect(() => ability.can('read', child)).not.toThrow();
      expect(ability.can('read', child)).toBe(false);
    });

    it('should deny rather than throw for a nested empty logical array', () => {
      const ability = abilityForRules([
        { action: 'read', subject: 'Child', conditions: { $or: [{ $and: [] }] } },
      ]);

      expect(() => ability.can('read', child)).not.toThrow();
      expect(ability.can('read', child)).toBe(false);
    });

    it('should deny rather than throw when a logical operator is not an array', () => {
      const ability = abilityForRules([
        { action: 'read', subject: 'Child', conditions: { $or: 'nope' } },
      ]);

      expect(() => ability.can('read', child)).not.toThrow();
      expect(ability.can('read', child)).toBe(false);
    });

    it('should still apply a valid rule when another rule for the same subject is unusable', () => {
      const ability = abilityForRules([
        { action: 'read', subject: 'Child', conditions: { center: 'center-1' } },
        { action: 'read', subject: 'Child', conditions: { $or: [] } },
      ]);

      expect(() => ability.can('read', child)).not.toThrow();
      expect(ability.can('read', child)).toBe(true);
    });

    it('should not widen access when an inverted rule has unusable conditions', () => {
      const ability = abilityForRules([
        { action: 'read', subject: 'Child' },
        {
          action: 'read',
          subject: 'Child',
          inverted: true,
          conditions: { $or: [] },
        },
      ]);

      expect(() => ability.can('read', child)).not.toThrow();
      expect(ability.can('read', child)).toBe(false);
    });
  });
});
