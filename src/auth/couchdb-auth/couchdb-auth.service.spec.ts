import { Test, TestingModule } from '@nestjs/testing';
import { CouchdbAuthService } from './couchdb-auth.service';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { CouchDBInteracter } from '../../utils/couchdb-interacter';
import { ConfigService } from '@nestjs/config';
import { HttpException, UnauthorizedException } from '@nestjs/common';

describe('CouchdbAuthService', () => {
  let service: CouchdbAuthService;

  let mockHttpService: HttpService;
  const DATABASE_URL = 'some.url';

  beforeEach(async () => {
    mockHttpService = {
      get: () => of({}),
    } as any;

    const config = {};
    config[CouchDBInteracter.DATABASE_URL_ENV] = DATABASE_URL;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouchdbAuthService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: new ConfigService(config) },
      ],
    }).compile();

    service = module.get<CouchdbAuthService>(CouchdbAuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return the user after receiving success response', async () => {
    const credentials = { username: 'username', password: 'somePass' };
    jest.spyOn(mockHttpService, 'get').mockReturnValue(
      of({
        data: { userCtx: { name: credentials.username, roles: ['user_app'] } },
      } as any),
    );

    const response = await service.login(
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

    return expect(service.login('user', 'wrong_pw')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
