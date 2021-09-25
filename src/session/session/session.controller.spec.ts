import { Test, TestingModule } from '@nestjs/testing';
import { SessionController } from './session.controller';
import { User } from './user-auth.dto';

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

    const response = controller.session({ user: user } as any);

    expect(response).toBe(user);
  });
});
