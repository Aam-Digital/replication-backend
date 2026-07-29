import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { UserInfo } from '../../../restricted-endpoints/session/user-auth.dto';
import { BasicAuthStrategy } from './basic-auth.strategy';

describe('BasicAuthStrategy', () => {
  let strategy: BasicAuthStrategy;
  let mockCouchdbService: CouchdbService;
  const user = new UserInfo('user-id', 'testUser', ['user_app']);

  beforeEach(async () => {
    mockCouchdbService = {
      login: jest.fn().mockReturnValue(of(user)),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BasicAuthStrategy,
        { provide: CouchdbService, useValue: mockCouchdbService },
      ],
    }).compile();

    strategy = module.get(BasicAuthStrategy);
  });

  it('should log in via CouchDB and return the user', async () => {
    const result = await strategy.validate('testUser', 'pass');

    expect(result).toBe(user);
    expect(mockCouchdbService.login).toHaveBeenCalledWith('testUser', 'pass');
  });

  it('should reuse a cached login within the TTL instead of calling CouchDB again', async () => {
    await strategy.validate('testUser', 'pass');
    const second = await strategy.validate('testUser', 'pass');

    expect(second).toBe(user);
    expect(mockCouchdbService.login).toHaveBeenCalledTimes(1);
  });

  it('should not serve the cached login for a different password', async () => {
    await strategy.validate('testUser', 'pass');

    jest
      .spyOn(mockCouchdbService, 'login')
      .mockReturnValue(throwError(() => new UnauthorizedException()));

    await expect(strategy.validate('testUser', 'wrong-pass')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mockCouchdbService.login).toHaveBeenCalledWith(
      'testUser',
      'wrong-pass',
    );
  });

  it('should not cache failed logins', async () => {
    jest
      .spyOn(mockCouchdbService, 'login')
      .mockReturnValue(throwError(() => new UnauthorizedException()));

    await expect(strategy.validate('testUser', 'bad')).rejects.toThrow();
    await expect(strategy.validate('testUser', 'bad')).rejects.toThrow();

    expect(mockCouchdbService.login).toHaveBeenCalledTimes(2);
  });

  it('should re-validate with CouchDB after the TTL expired', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);

    await strategy.validate('testUser', 'pass');
    nowSpy.mockReturnValue(BasicAuthStrategy.LOGIN_CACHE_TTL_MS + 1);
    await strategy.validate('testUser', 'pass');

    expect(mockCouchdbService.login).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });
});
