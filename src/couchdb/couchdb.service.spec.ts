import { Test, TestingModule } from '@nestjs/testing';
import { CouchdbService } from './couchdb.service';
import { firstValueFrom, of, throwError } from 'rxjs';
import {
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';

describe('CouchdbService', () => {
  let service: CouchdbService;
  let mockHttpService: HttpService;
  let responseInterceptor: (err: any) => any;

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
            use: (onFulfilled: any, onRejected: any) =>
              (responseInterceptor = onRejected),
          },
        },
      },
    } as any;

    const config: Record<string, string> = {};
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

  it('should transform axios errors to HttpExceptions with the same status code', async () => {
    const axiosError = {
      response: {
        data: {
          error: 'not_found',
          reason: 'missing',
        },
        status: 404,
      },
    };

    let result!: HttpException;
    try {
      await responseInterceptor(axiosError);
    } catch (err) {
      result = err as HttpException;
    }
    expect(result).toBeInstanceOf(HttpException);
    expect(result.getStatus()).toBe(404);
    expect(result.getResponse()).toBe(axiosError.response.data);
  });

  it('should map a failed request that carries a success status to Bad Gateway', async () => {
    // a body cut short after CouchDB already answered 200 must not reach the
    // client as a 200, or a truncated response looks like a complete one
    const axiosError = {
      message: 'aborted',
      response: { data: '', status: 200 },
    };

    const result = await responseInterceptor(axiosError).catch(
      (err: HttpException) => err,
    );

    expect(result).toBeInstanceOf(HttpException);
    expect(result.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
  });

  it('should not buffer an oversized error body of a stream request', async () => {
    const hugeBody = Readable.from(
      (function* () {
        for (let i = 0; i < 512; i++) {
          yield 'x'.repeat(1024);
        }
      })(),
    );
    (mockHttpService.axiosRef as any).request = jest
      .fn()
      .mockRejectedValue(new HttpException(hugeBody as any, 500));

    const error: HttpException = await service
      .getStream('db', '_all_docs')
      .catch((err) => err);

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(500);
    expect(JSON.stringify(error.getResponse()).length).toBeLessThan(1024);
    expect(hugeBody.destroyed).toBe(true);
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
