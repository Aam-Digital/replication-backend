import { Test, TestingModule } from '@nestjs/testing';
import { DocumentRule, RulesService } from './rules.service';
import { User } from '../../session/session/user-auth.dto';

describe('RulesService', () => {
  let service: RulesService;
  let adminRules: DocumentRule[];
  let userRules: DocumentRule[];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RulesService],
    }).compile();

    service = module.get<RulesService>(RulesService);
    service.initRules();

    adminRules = [{ action: 'manage', subject: 'Aser' }];
    service.rules.set('admin', adminRules);
    userRules = [{ action: ['read', 'write'], subject: 'Aser' }];
    service.rules.set('user', userRules);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should only return the rules for the passed user roles', () => {
    let result = service.getRulesForUser(new User('normalUser', ['user']));

    expect(result).toEqual(userRules);

    result = service.getRulesForUser(new User('superUser', ['user', 'admin']));
    expect(result).toEqual(userRules.concat(adminRules));
  });
});
