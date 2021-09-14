import { Test, TestingModule } from '@nestjs/testing';
import { PermissionService } from './permission.service';
import { RulesService } from '../rules/rules.service';

describe('PermissionService', () => {
  let service: PermissionService;
  let mockRulesService: RulesService;

  beforeEach(async () => {
    mockRulesService = {
      getRulesForRoles: () => undefined,
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionService,
        { provide: RulesService, useValue: mockRulesService },
      ],
    }).compile();

    service = module.get<PermissionService>(PermissionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should give permission if no rules are defined', () => {
    jest.spyOn(mockRulesService, 'getRulesForRoles').mockReturnValue([]);

    expect(service.hasPermissionFor(undefined, undefined)).toBe(true);
  });
});
