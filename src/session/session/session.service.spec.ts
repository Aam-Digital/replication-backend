import { Test, TestingModule } from '@nestjs/testing';
import { SessionService } from './session.service';

describe('SessionService', () => {
  let service: SessionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SessionService],
    }).compile();

    service = module.get<SessionService>(SessionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should be logged in after a user has been set', () => {
    service.login({ name: 'user', roles: [] });

    expect(service.isLoggedIn()).toBe(true);
  });

  it('should return the roles after a user is logged in', () => {
    service.login({ name: 'user', roles: ['user_app'] });

    expect(service.getRoles()).toEqual(['user_app']);
  });

  it('should remove user data after user is logged out', () => {
    service.login({ name: 'user', roles: ['user_app'] });

    expect(service.isLoggedIn()).toBe(true);
    expect(service.getRoles()).toEqual(['user_app']);

    service.logout();

    expect(service.isLoggedIn()).toBe(false);
    expect(service.getRoles()).not.toEqual(['user_app']);
  });
});
