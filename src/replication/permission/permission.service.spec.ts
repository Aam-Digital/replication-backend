import { Test, TestingModule } from '@nestjs/testing';
import { PermissionService } from './permission.service';
import { RulesService } from '../rules/rules.service';
import { User } from '../../session/session/user-auth.dto';
import { DatabaseDocument } from '../couch-proxy/couchdb-dtos/bulk-docs.dto';

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
      .mockReturnValue([{ action: 'write', subject: 'Aser' }]);

    const ability = service.getAbilityFor(normalUser);

    const aserDoc: DatabaseDocument = { _id: 'Aser:someId', _rev: 'someRev' };
    expect(ability.can('write', aserDoc)).toBe(true);
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
    expect(ability.cannot('write', aserDoc)).toBe(true);
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
    expect(ability.can('write', childDoc)).toBe(true);
    expect(ability.can('read', childDoc)).toBe(true);
  });
});
