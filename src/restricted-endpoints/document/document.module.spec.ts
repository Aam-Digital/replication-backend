import { DocumentModule } from './document.module';
import { HttpService } from '@nestjs/axios';
import { CouchDBInteracter } from '../../utils/couchdb-interacter';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';

describe('DocumentModule', () => {
  let module: DocumentModule;
  let mockHttpService: HttpService;
  let responseInterceptor: (err) => any;
  const username = 'demo';
  const password = 'pass';
  beforeEach(() => {
    mockHttpService = {
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
    config[CouchDBInteracter.DATABASE_USER_ENV] = username;
    config[CouchDBInteracter.DATABASE_PASSWORD_ENV] = password;
    const configService = new ConfigService(config);

    module = new DocumentModule(mockHttpService, configService);
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
});
