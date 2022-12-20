import { Test, TestingModule } from '@nestjs/testing';
import { SessionController } from './session.controller';
import { UserInfo } from './user-auth.dto';
import { CombinedAuthMiddleware } from '../../auth/guards/combined-auth/combined-auth.middleware';

describe('SessionController', () => {
  let controller: SessionController;
  let mockCombinedAuth: CombinedAuthMiddleware;

  beforeEach(async () => {
    mockCombinedAuth = { use: () => Promise.resolve() } as any;
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [
        { provide: CombinedAuthMiddleware, useValue: mockCombinedAuth },
      ],
    }).compile();

    controller = module.get<SessionController>(SessionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return the user object on the request', () => {
    const user = new UserInfo('user', ['user_app']);

    const response = controller.login({ user: user } as any);

    expect(response).toBe(user);
  });

  it('should return user object from combinedAuth middleware if user is authenticated', async () => {
    const user = new UserInfo('user', ['user_app']);

    const res = await controller.session(user);

    expect(res).toHaveBeenCalledWith({ ok: true, userCtx: user });
  });
});
