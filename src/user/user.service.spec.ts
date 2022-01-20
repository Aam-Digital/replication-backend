import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { of } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { CouchProxyController } from '../replication/couch-proxy/couch-proxy.controller';
import { ConfigService } from '@nestjs/config';

describe('UserService', () => {
  let service: UserService;
  let mockHttpService: HttpService;
  let mockConfigService: ConfigService;
  const DATABASE_URL = 'database.url';
  const USERNAME = 'demo';
  const PASSWORD = 'pass';
  const COUCHDB_USERNAME = 'org.couchdb.user:testUser';
  const COUCHDB_USER_URL = DATABASE_URL + '/_users/' + COUCHDB_USERNAME;
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
      put: () => of({}),
      axiosRef: { defaults: { auth: undefined } },
    } as any;

    const config = {};
    config[CouchProxyController.DATABASE_USER_ENV] = USERNAME;
    config[CouchProxyController.DATABASE_PASSWORD_ENV] = PASSWORD;
    config[CouchProxyController.DATABASE_URL_ENV] = DATABASE_URL;
    mockConfigService = {
      get: jest.fn((key) => config[key]),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should send the updated user object to the database', async () => {
    jest
      .spyOn(mockHttpService, 'put')
      .mockReturnValue(of({ data: SUCCESS_RESPONSE } as any));
    const userWithPassword = Object.assign(
      { password: 'newPass' },
      COUCHDB_USER_OBJECT,
    );

    const response = service.updateUserObject(
      COUCHDB_USER_OBJECT,
      userWithPassword,
    );

    await expect(response).resolves.toBe(SUCCESS_RESPONSE);
    expect(mockHttpService.put).toHaveBeenCalledWith(
      COUCHDB_USER_URL,
      userWithPassword,
    );
  });

  it('should only allow modification of the password property', async () => {
    jest
      .spyOn(mockHttpService, 'put')
      .mockReturnValue(of({ data: SUCCESS_RESPONSE } as any));
    const modifiedUser = Object.assign(
      { password: 'newPass' },
      COUCHDB_USER_OBJECT,
    );
    modifiedUser.roles = ['admin_app'];

    const response = service.updateUserObject(
      COUCHDB_USER_OBJECT,
      modifiedUser,
    );

    await expect(response).resolves.toBe(SUCCESS_RESPONSE);
    const onlyChangedPassword = Object.assign(
      { password: 'newPass' },
      COUCHDB_USER_OBJECT,
    );
    expect(mockHttpService.put).toHaveBeenCalledWith(
      COUCHDB_USER_URL,
      onlyChangedPassword,
    );
  });
});
