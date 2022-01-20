import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { ConfigService } from '@nestjs/config';
import { CouchProxyController } from '../replication/couch-proxy/couch-proxy.controller';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, of, throwError } from 'rxjs';
import { UnauthorizedException } from '@nestjs/common';
import { UserService } from './user.service';

describe('UserController', () => {
  let controller: UserController;
  let mockHttpService: HttpService;
  let mockConfigService: ConfigService;
  let mockUserService: UserService;
  const DATABASE_URL = 'database.url';
  const USERNAME = 'demo';
  const PASSWORD = 'pass';
  const COUCHDB_USERNAME = 'org.couchdb.user:testUser';
  const BASIC_AUTH_HEADER = 'Basic someHash';
  const COUCHDB_USER_OBJECT = {
    _id: COUCHDB_USERNAME,
    _rev: '1-e0ebfb84005b920488fc7a8cc5470cc0',
    derived_key: 'e579375db0e0c6a6fc79cd9e36a36859f71575c3',
    iterations: 10,
    name: 'testUser',
    password_scheme: 'pbkdf2',
    roles: [],
    salt: '1112283cf988a34f124200a050d308a1',
    type: 'user',
  };
  const SUCCESS_RESPONSE = {
    ok: true,
    id: COUCHDB_USER_OBJECT._id,
    rev: COUCHDB_USER_OBJECT._rev,
  };

  beforeEach(async () => {
    mockHttpService = {
      get: () => of({}),
      put: () => of({}),
    } as any;

    mockUserService = {
      updateUserObject: () => Promise.resolve(undefined),
    } as any;

    const config = {};
    config[CouchProxyController.DATABASE_USER_ENV] = USERNAME;
    config[CouchProxyController.DATABASE_PASSWORD_ENV] = PASSWORD;
    config[CouchProxyController.DATABASE_URL_ENV] = DATABASE_URL;
    mockConfigService = {
      get: jest.fn((key) => config[key]),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: UserService, useValue: mockUserService },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should forward the get user request with basic auth headers', async () => {
    jest
      .spyOn(mockHttpService, 'get')
      .mockReturnValue(of({ data: COUCHDB_USER_OBJECT } as any));

    const response = firstValueFrom(
      controller.getUser(COUCHDB_USERNAME, BASIC_AUTH_HEADER),
    );

    await expect(response).resolves.toEqual(COUCHDB_USER_OBJECT);
    expect(mockHttpService.get).toHaveBeenCalledWith(
      DATABASE_URL + '/_users/' + COUCHDB_USERNAME,
      {
        headers: {
          authorization: BASIC_AUTH_HEADER,
        },
      },
    );
  });

  it('should fail the user get request with 401 unauthorized response when http request fails', () => {
    jest
      .spyOn(mockHttpService, 'get')
      .mockReturnValue(throwError(() => new Error()));

    const response = firstValueFrom(controller.getUser('', ''));

    return expect(response).rejects.toThrow(UnauthorizedException);
  });

  it('should call updateUser with the old and new user object', async () => {
    jest
      .spyOn(mockHttpService, 'get')
      .mockReturnValue(of({ data: COUCHDB_USER_OBJECT } as any));
    jest
      .spyOn(mockUserService, 'updateUserObject')
      .mockReturnValue(Promise.resolve(SUCCESS_RESPONSE));

    const userWithPassword = Object.assign(
      { password: 'newPass' },
      COUCHDB_USER_OBJECT,
    );

    const response = controller.putUser(
      COUCHDB_USERNAME,
      userWithPassword,
      BASIC_AUTH_HEADER,
    );

    await expect(response).resolves.toBe(SUCCESS_RESPONSE);
    expect(mockUserService.updateUserObject).toHaveBeenCalledWith(
      COUCHDB_USER_OBJECT,
      userWithPassword,
    );
  });

  it('should not send put request if basic auth header is invalid', async () => {
    jest
      .spyOn(mockHttpService, 'get')
      .mockReturnValue(throwError(() => new Error()));
    jest.spyOn(mockHttpService, 'put');

    const response = controller.putUser(
      USERNAME,
      { password: 'newPass' },
      BASIC_AUTH_HEADER,
    );

    await expect(response).rejects.toThrow(UnauthorizedException);
    expect(mockHttpService.get).toHaveBeenCalled();
    expect(mockHttpService.put).not.toHaveBeenCalled();
  });
});
