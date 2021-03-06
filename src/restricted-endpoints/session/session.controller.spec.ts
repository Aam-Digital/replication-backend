import { Test, TestingModule } from '@nestjs/testing';
import { SessionController } from './session.controller';
import { User } from './user-auth.dto';
import { CombinedAuthMiddleware } from '../../auth/guards/combined-auth.middleware';

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
    const user = new User('user', ['user_app']);

    const response = controller.login({ user: user } as any);

    expect(response).toBe(user);
  });

  it('should return user object from combinedAuth middleware if user is authenticated', async () => {
    const user = new User('user', ['user_app']);
    jest
      .spyOn(mockCombinedAuth, 'use')
      .mockImplementation(async (req) => (req.user = user) as any);
    const response = { send: () => {} };
    jest.spyOn(response, 'send');

    await controller.session({}, response);

    expect(response.send).toHaveBeenCalledWith({ ok: true, userCtx: user });
  });
});
