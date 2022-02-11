import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BasicAuthStrategy } from './basic-auth.strategy';
import { CouchDBInteracter } from '../../../utils/couchdb-interacter';

describe('BasicAuthStrategy', () => {
  let strategy: BasicAuthStrategy;
  let mockHttpService: HttpService;
  let mockConfigService: ConfigService;
  const DATABASE_URL = 'some.url';

  beforeEach(async () => {
    mockHttpService = {
      get: () => of({}),
    } as any;

    const config = {};
    config[CouchDBInteracter.DATABASE_URL_ENV] = DATABASE_URL;
    mockConfigService = {
      get: jest.fn((key) => config[key]),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BasicAuthStrategy,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    strategy = module.get<BasicAuthStrategy>(BasicAuthStrategy);
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  it('should read the url for the auth server from the config', () => {
    expect(mockConfigService.get).toHaveBeenCalledWith(
      CouchDBInteracter.DATABASE_URL_ENV,
    );
  });

  it('should return the user after receiving success response', async () => {
    const credentials = { username: 'username', password: 'somePass' };
    jest.spyOn(mockHttpService, 'get').mockReturnValue(
      of({
        data: {
          userCtx: { name: credentials.username, roles: ['user_app'] },
        },
      } as any),
    );

    const response = await strategy.validate(
      credentials.username,
      credentials.password,
    );

    expect(mockHttpService.get).toHaveBeenCalledWith(
      `${DATABASE_URL}/_session`,
      { auth: credentials },
    );
    expect(response).toEqual({ name: 'username', roles: ['user_app'] });
  });

  it('should throw unauthorized exception when the requests fails', () => {
    jest
      .spyOn(mockHttpService, 'get')
      .mockReturnValue(throwError(() => new HttpException('error', 400)));

    return expect(strategy.validate('user', 'wrong_pw')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
