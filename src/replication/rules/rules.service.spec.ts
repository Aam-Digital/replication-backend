import { Test, TestingModule } from '@nestjs/testing';
import { DocumentRule, RulesService } from './rules.service';
import { User } from '../../session/session/user-auth.dto';
import * as TestRules from '../../assets/rules.json';

describe('RulesService', () => {
  let service: RulesService;
  let adminRules: DocumentRule[];
  let userRules: DocumentRule[];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RulesService],
    }).compile();

    service = module.get<RulesService>(RulesService);

    adminRules = TestRules.admin_app as any;
    userRules = TestRules.user_app as any;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should only return the rules for the passed user roles', () => {
    let result = service.getRulesForUser(new User('normalUser', ['user_app']));

    expect(result).toEqual(userRules);

    result = service.getRulesForUser(
      new User('superUser', ['user_app', 'admin_app']),
    );
    expect(result).toEqual(userRules.concat(adminRules));
  });
});
