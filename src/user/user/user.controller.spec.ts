import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { ConfigService } from '@nestjs/config';
import { CouchProxyController } from '../../replication/couch-proxy/couch-proxy.controller';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, of, throwError } from 'rxjs';
import { UnauthorizedException } from '@nestjs/common';

describe('UserController', () => {
  let controller: UserController;
  let mockHttpService: HttpService;
  let mockConfigService: ConfigService;
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
  const COUCHDB_USER_URL = DATABASE_URL + '/_users/' + COUCHDB_USERNAME;

  beforeEach(async () => {
    mockHttpService = {
      get: () => of({}),
      put: () => of({}),
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
          Authorization: BASIC_AUTH_HEADER,
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

  it('should forward the request with admin credentials if user is updating own document', async () => {
    jest
      .spyOn(mockHttpService, 'get')
      .mockReturnValue(of({ data: COUCHDB_USER_OBJECT } as any));
    jest
      .spyOn(mockHttpService, 'put')
      .mockReturnValue(of({ data: SUCCESS_RESPONSE } as any));
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
    expect(mockHttpService.get).toHaveBeenCalledWith(COUCHDB_USER_URL, {
      headers: { Authorization: BASIC_AUTH_HEADER },
    });
    expect(mockHttpService.put).toHaveBeenCalledWith(
      COUCHDB_USER_URL,
      userWithPassword,
      { auth: { username: USERNAME, password: PASSWORD } },
    );
  });

  it('should not sent put request if basic auth header is invalid', async () => {
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

  it('should only allow modification of the password property', async () => {
    jest
      .spyOn(mockHttpService, 'get')
      .mockReturnValue(of({ data: COUCHDB_USER_OBJECT } as any));
    jest
      .spyOn(mockHttpService, 'put')
      .mockReturnValue(of({ data: SUCCESS_RESPONSE } as any));
    const modifiedUser = Object.assign(
      { password: 'newPass' },
      COUCHDB_USER_OBJECT,
    );
    modifiedUser.roles = ['admin_app'];

    const response = controller.putUser(
      COUCHDB_USERNAME,
      modifiedUser,
      BASIC_AUTH_HEADER,
    );

    await expect(response).resolves.toBe(SUCCESS_RESPONSE);
    expect(mockHttpService.get).toHaveBeenCalled();
    const onlyChangedPassword = Object.assign(
      { password: 'newPass' },
      COUCHDB_USER_OBJECT,
    );
    expect(mockHttpService.put).toHaveBeenCalledWith(
      COUCHDB_USER_URL,
      onlyChangedPassword,
      { auth: { username: USERNAME, password: PASSWORD } },
    );
  });
});
