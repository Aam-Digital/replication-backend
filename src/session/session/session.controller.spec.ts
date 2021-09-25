import { Test, TestingModule } from '@nestjs/testing';
import { SessionController } from './session.controller';
import { User } from './user-auth.dto';
import { TOKEN_KEY } from '../cookie/cookie.service';

describe('SessionController', () => {
  let controller: SessionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
    }).compile();

    controller = module.get<SessionController>(SessionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return the user object on the request', () => {
    const user = new User('user', ['user_app']);

    const response = controller.login({ user: user } as any);

    expect(response).toBe(user);
  });

  it('should return a empty cookie when calling logout', () => {
    const response = {
      cookie: jest.fn(),
      send: jest.fn(),
    };

    controller.logout(response);

    expect(response.cookie).toHaveBeenCalledWith(TOKEN_KEY, '', {
      httpOnly: true,
    });
    expect(response.send).toHaveBeenCalled();
  });
});
