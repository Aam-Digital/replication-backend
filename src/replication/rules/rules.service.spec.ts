import { Test, TestingModule } from '@nestjs/testing';
import { DocumentRule, RulesService } from './rules.service';
import { User } from '../../session/session/user-auth.dto';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, of, throwError } from 'rxjs';
import { Permission } from './permission';
import { CouchProxyController } from '../couch-proxy/couch-proxy.controller';
import { ConfigService } from '@nestjs/config';

describe('RulesService', () => {
  let service: RulesService;
  let adminRules: DocumentRule[];
  let userRules: DocumentRule[];
  let mockHttpService: HttpService;
  let testPermission: Permission;
  const DATABASE_URL = 'database.url';
  const DATABASE_NAME = 'app';

  beforeEach(async () => {
    testPermission = new Permission({
      user_app: [
        { action: 'read', subject: 'Aser' },
        { action: 'read', subject: 'Child', inverted: true },
      ],
      admin_app: [{ action: 'manage', subject: 'Child' }],
    });
    mockHttpService = {
      get: () => of({ data: testPermission }),
      axiosRef: { defaults: { auth: undefined } },
    } as any;
    jest.spyOn(mockHttpService, 'get');

    const config = {};
    config[CouchProxyController.DATABASE_URL_ENV] = DATABASE_URL;
    config[CouchProxyController.DATABASE_NAME_ENV] = DATABASE_NAME;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RulesService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: new ConfigService(config) },
      ],
    }).compile();

    service = module.get<RulesService>(RulesService);
    await firstValueFrom(service.loadRules());

    userRules = testPermission.rulesConfig['user_app'];
    adminRules = testPermission.rulesConfig['admin_app'];
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should fetch the rules from the db', () => {
    expect(mockHttpService.get).toHaveBeenCalledWith(
      `${DATABASE_URL}/${DATABASE_NAME}/${Permission.DOC_ID}`,
    );
  });

  it('should allow everything in case no rules object could be found', async () => {
    jest
      .spyOn(mockHttpService, 'get')
      .mockReturnValue(throwError(() => new Error()));

    await firstValueFrom(service.loadRules());

    expect(service.getRulesForUser(new User('some-user', []))).toEqual([
      {
        subject: 'all',
        action: 'manage',
      },
    ]);
  });

  it('should only return the rules for the passed user roles', () => {
    let result = service.getRulesForUser(new User('normalUser', ['user_app']));

    expect(result).toEqual(userRules);

    result = service.getRulesForUser(
      new User('superUser', ['user_app', 'admin_app']),
    );
    expect(result).toEqual(userRules.concat(adminRules));
  });

  it('should not fail if no rules exist for a given role', () => {
    const result = service.getRulesForUser(
      new User('specialUser', ['user_app', 'manager_app']),
    );
    expect(result).toEqual(userRules);
  });
});
