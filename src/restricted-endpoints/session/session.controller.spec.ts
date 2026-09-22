import { Test, TestingModule } from '@nestjs/testing';
import { SessionController } from './session.controller';
import { UserInfo } from './user-auth.dto';
import { authGuardMockProviders } from '../../auth/auth-guard-mock.providers';
import { BodyAuthGuard } from '../../auth/guards/body-auth/body-auth.guard';
import { CombinedAuthGuard } from '../../auth/guards/combined-auth/combined-auth.guard';

describe('SessionController', () => {
  let controller: SessionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [...authGuardMockProviders],
    })
      .overrideGuard(BodyAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CombinedAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SessionController>(SessionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return the user object on the request', () => {
    const user = new UserInfo('user-id', 'user', ['user_app']);

    const response = controller.login(user);

    expect(response).toBe(user);
  });

  it('should return user object from combinedAuth middleware if user is authenticated', async () => {
    const user = new UserInfo('user-id', 'user', ['user_app']);

    const res = await controller.session(user);

    expect(res).toEqual({ ok: true, userCtx: user });
  });
});
