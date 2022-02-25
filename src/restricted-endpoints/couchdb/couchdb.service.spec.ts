import { Test, TestingModule } from '@nestjs/testing';
import { CouchdbService } from './couchdb.service';
import { firstValueFrom, of, throwError } from 'rxjs';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

describe('CouchdbService', () => {
  let service: CouchdbService;
  let mockHttpService: HttpService;
  let responseInterceptor: (err) => any;

  const DATABASE_URL = 'some.url';
  const username = 'demo';
  const password = 'pass';

  beforeEach(async () => {
    mockHttpService = {
      post: () => of({}),
      get: () => of({}),
      put: () => of({}),
      delete: () => of({}),
      axiosRef: {
        defaults: {},
        interceptors: {
          response: {
            use: (onFulfilled, onRejected) =>
              (responseInterceptor = onRejected),
          },
        },
      },
    } as any;

    const config = {};
    config[CouchdbService.DATABASE_URL_ENV] = DATABASE_URL;
    config[CouchdbService.DATABASE_USER_ENV] = username;
    config[CouchdbService.DATABASE_PASSWORD_ENV] = password;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouchdbService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: new ConfigService(config) },
      ],
    }).compile();

    service = module.get<CouchdbService>(CouchdbService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should set the default auth header', () => {
    expect(mockHttpService.axiosRef.defaults.auth).toEqual({
      username: username,
      password: password,
    });
  });

  it('should transform axios errors to HttpExceptions with the same status code', () => {
    const axiosError = {
      response: {
        data: {
          error: 'not_found',
          reason: 'missing',
        },
        status: 404,
      },
    };

    let result: HttpException;
    try {
      responseInterceptor(axiosError);
    } catch (err) {
      result = err;
    }
    expect(result).toBeInstanceOf(HttpException);
    expect(result.getStatus()).toBe(404);
    expect(result.getResponse()).toBe(axiosError.response.data);
  });

  it('should return the user after receiving success response', async () => {
    const credentials = { username: 'username', password: 'somePass' };
    jest.spyOn(mockHttpService, 'get').mockReturnValue(
      of({
        data: { userCtx: { name: credentials.username, roles: ['user_app'] } },
      } as any),
    );

    const response = await firstValueFrom(
      service.login(credentials.username, credentials.password),
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

    const response = firstValueFrom(service.login('user', 'wrong_pw'));
    return expect(response).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
