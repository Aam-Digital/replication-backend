import { Test, TestingModule } from '@nestjs/testing';
import { PermissionService } from './permission.service';
import { RulesService } from '../rules/rules.service';
import { User } from '../../session/session/user-auth.dto';
import { DatabaseDocument } from '../couch-proxy/couchdb-dtos/bulk-docs.dto';
import { Permission } from '../rules/permission';

describe('PermissionService', () => {
  let service: PermissionService;
  let mockRulesService: RulesService;
  let normalUser: User;

  beforeEach(async () => {
    mockRulesService = {
      getRulesForUser: () => undefined,
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionService,
        { provide: RulesService, useValue: mockRulesService },
      ],
    }).compile();

    service = module.get<PermissionService>(PermissionService);

    normalUser = new User('normalUser', ['user_app']);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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

  it('should return a ability that does not allow to modify the permission document', () => {
    jest
      .spyOn(mockRulesService, 'getRulesForUser')
      .mockReturnValue([{ action: 'manage', subject: 'all' }]);

    const ability = service.getAbilityFor(normalUser);

    const permissionDoc: Permission = {
      _id: `Permission:${Permission.DOC_ID}`,
      _rev: 'someRev',
      rulesConfig: {},
    };
    expect(ability.cannot('create', permissionDoc)).toBe(true);
    expect(ability.cannot('update', permissionDoc)).toBe(true);
    expect(ability.cannot('delete', permissionDoc)).toBe(true);
    expect(ability.can('read', permissionDoc)).toBe(true);
  });
});
