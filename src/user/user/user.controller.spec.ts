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
    const username = 'org.couchdb.user:testUser';
    const basicAuthString = 'Basic someHash';
    const couchDBUserObject = {
      _id: username,
      _rev: '1-e0ebfb84005b920488fc7a8cc5470cc0',
      derived_key: 'e579375db0e0c6a6fc79cd9e36a36859f71575c3',
      iterations: 10,
      name: 'testUser',
      password_scheme: 'pbkdf2',
      roles: [],
      salt: '1112283cf988a34f124200a050d308a1',
      type: 'user',
    };
    jest
      .spyOn(mockHttpService, 'get')
      .mockReturnValue(of({ data: couchDBUserObject } as any));

    const response = firstValueFrom(
      controller.getUser(username, basicAuthString),
    );

    await expect(response).resolves.toEqual(couchDBUserObject);
    expect(mockHttpService.get).toHaveBeenCalledWith(
      DATABASE_URL + '/_users/' + username,
      {
        headers: {
          authorization: basicAuthString,
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
});
