import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { DocSuccess } from '../replication/couch-proxy/couchdb-dtos/bulk-docs.dto';
import { COUCHDB_USER_DOC } from '../session/session/user-auth.dto';

describe('UserController', () => {
  let controller: UserController;
  let mockUserService: UserService;
  const couchDBUsername = `${COUCHDB_USER_DOC}:testUser`;
  const couchDBUserObject = {
    _id: couchDBUsername,
    _rev: '1-e0ebfb84005b920488fc7a8cc5470cc0',
    derived_key: 'e579375db0e0c6a6fc79cd9e36a36859f71575c3',
    iterations: 10,
    name: 'testUser',
    password_scheme: 'pbkdf2',
    roles: [],
    salt: '1112283cf988a34f124200a050d308a1',
    type: 'user',
  };
  const successResponse: DocSuccess = {
    ok: true,
    id: couchDBUserObject._id,
    rev: couchDBUserObject._rev,
  };
  const requestingUser = {
    name: 'username',
    role: ['user_app'],
  };
  beforeEach(async () => {
    mockUserService = {
      getUserObject: () => Promise.resolve(undefined),
      updateUserObject: () => Promise.resolve(undefined),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: UserService, useValue: mockUserService }],
    }).compile();

    controller = module.get<UserController>(UserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call getUser with the username and the requesting user', async () => {
    jest
      .spyOn(mockUserService, 'getUserObject')
      .mockReturnValue(Promise.resolve(couchDBUserObject));

    const response = controller.getUser(couchDBUsername, {
      user: requestingUser,
    } as any);

    await expect(response).resolves.toBe(couchDBUserObject);
    expect(mockUserService.getUserObject).toHaveBeenCalledWith(
      couchDBUsername,
      requestingUser,
    );
  });

  it('should call updateUser with the body and the requesting user', async () => {
    jest
      .spyOn(mockUserService, 'updateUserObject')
      .mockReturnValue(Promise.resolve(successResponse));

    const userWithPassword = Object.assign(
      { password: 'newPass' },
      couchDBUserObject,
    );

    const response = controller.putUser(userWithPassword, {
      user: requestingUser,
    } as any);

    await expect(response).resolves.toBe(successResponse);
    expect(mockUserService.updateUserObject).toHaveBeenCalledWith(
      userWithPassword,
      requestingUser,
    );
  });
});
