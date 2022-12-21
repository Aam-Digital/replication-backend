import { CombinedAuthGuard } from './combined-auth.guard';
import { BasicAuthGuard } from '../basic-auth/basic-auth.guard';
import { JwtCookieGuard } from '../jwt-cookie/jwt-cookie.guard';
import { JwtBearerGuard } from '../jwt-bearer/jwt-bearer.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { UserInfo } from '../../../restricted-endpoints/session/user-auth.dto';

describe('CombinedAuthGuard', () => {
  const basicAuthGuard: BasicAuthGuard = {
    canActivate: () => Promise.reject(new UnauthorizedException()),
  } as any;
  const jwtCookieGuard: JwtCookieGuard = {
    canActivate: () => Promise.reject(new UnauthorizedException()),
  } as any;
  const jwtBearerGuard: JwtBearerGuard = {
    canActivate: () => Promise.reject(new UnauthorizedException()),
  } as any;
  const reflector: Reflector = { getAllAndOverride: () => false } as any;
  let guard: CombinedAuthGuard;
  const mockContext: ExecutionContext = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({}) }),
  } as any;

  beforeEach(() => {
    guard = new CombinedAuthGuard(
      basicAuthGuard,
      jwtCookieGuard,
      jwtBearerGuard,
      reflector,
    );
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('[GUARD] should not throw error if user is not logged in', () => {
    return expect(guard.canActivate(mockContext)).resolves.toBe(true);
  });

  it('[GUARD] should throw unauthorized exception if login is required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    return expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('[MIDDLEWARE/GUARD] should assign user to sentry after a successful authentication', async () => {
    jest.spyOn(basicAuthGuard, 'canActivate').mockResolvedValue(true);
    const user = new UserInfo('testUser', []);
    const setUserSpy = jest.spyOn(Sentry, 'setUser');

    await guard.use({ user } as any, undefined, () => undefined);

    expect(setUserSpy).toHaveBeenCalledWith({ username: 'testUser' });

    setUserSpy.mockReset();
    jest
      .spyOn(mockContext, 'switchToHttp')
      .mockReturnValue({ getRequest: () => ({ user }) } as any);

    await guard.canActivate(mockContext);

    expect(setUserSpy).toHaveBeenCalledWith({ username: 'testUser' });
  });

  it('[MIDDLEWARE] should call next if authentication passes', async () => {
    jest.spyOn(jwtCookieGuard, 'canActivate').mockResolvedValue(true);
    let funCalled = false;
    const user = new UserInfo('testUser', []);

    await guard.use({ user } as any, undefined, () => (funCalled = true));

    expect(funCalled).toBe(true);
  });
});
