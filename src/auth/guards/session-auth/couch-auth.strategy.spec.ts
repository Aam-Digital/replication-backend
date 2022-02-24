import { Test, TestingModule } from '@nestjs/testing';
import { CouchAuthStrategy } from './couch-auth.strategy';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CouchDBInteracter } from '../../../utils/couchdb-interacter';

describe('CouchAuthStrategy', () => {
  let strategy: CouchAuthStrategy;
  let mockHttpService: HttpService;
  const DATABASE_URL = 'some.url';

  beforeEach(async () => {
    mockHttpService = {
      post: () => of({}),
    } as any;

    const config = {};
    config[CouchDBInteracter.DATABASE_URL_ENV] = DATABASE_URL;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouchAuthStrategy,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: new ConfigService(config) },
      ],
    }).compile();

    strategy = module.get<CouchAuthStrategy>(CouchAuthStrategy);
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  it('should return the user after receiving success response', async () => {
    const credentials = { name: 'username', password: 'somePass' };
    jest.spyOn(mockHttpService, 'post').mockReturnValue(
      of({
        data: { name: credentials.name, roles: ['user_app'] },
      } as any),
    );

    const response = await strategy.validate(
      credentials.name,
      credentials.password,
    );

    expect(mockHttpService.post).toHaveBeenCalledWith(
      `${DATABASE_URL}/_session`,
      credentials,
    );
    expect(response).toEqual({ name: 'username', roles: ['user_app'] });
  });

  it('should throw unauthorized exception when the requests fails', () => {
    jest
      .spyOn(mockHttpService, 'post')
      .mockReturnValue(throwError(() => new HttpException('error', 400)));

    return expect(strategy.validate('user', 'wrong_pw')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
