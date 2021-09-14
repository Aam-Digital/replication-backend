import { Test, TestingModule } from '@nestjs/testing';
import { RulesService } from './rules.service';
import { Actions, ALL_SUBJECTS } from './actions';
import { RawRule } from '@casl/ability';

describe('RulesService', () => {
  let service: RulesService;
  let adminRules: RawRule[];
  let userRules: RawRule[];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RulesService],
    }).compile();

    service = module.get<RulesService>(RulesService);
    service.initRules();

    adminRules = [{ action: Actions.MANAGE, subject: ALL_SUBJECTS }];
    service.rules.set('admin', adminRules);
    userRules = [
      { action: [Actions.READ, Actions.UPDATE], subject: ALL_SUBJECTS },
    ];
    service.rules.set('user', userRules);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should only return the rules for the passed user roles', () => {
    let result = service.getRulesForRoles(['user']);

    expect(result).toEqual(userRules);

    result = service.getRulesForRoles(['user', 'admin']);
    expect(result).toEqual(userRules.concat(adminRules));
  });
});
