import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { UserInfo } from '../../../restricted-endpoints/session/user-auth.dto';
import { BasicAuthGuard } from './basic-auth.guard';
import { BasicAuthStrategy } from './basic-auth.strategy';

describe('BasicAuthGuard', () => {
  const user = new UserInfo('user-id', 'testUser', ['user_app']);
  let strategy: BasicAuthStrategy;
  let guard: BasicAuthGuard;

  beforeEach(() => {
    strategy = { validate: jest.fn().mockResolvedValue(user) } as any;
    guard = new BasicAuthGuard(strategy);
  });

  function contextWithHeader(authorization?: string) {
    const req: { headers: Record<string, string>; user?: UserInfo } = {
      headers: authorization === undefined ? {} : { authorization },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as ExecutionContext;
    return { req, context };
  }

  const basic = (credentials: string) =>
    'Basic ' + Buffer.from(credentials).toString('base64');

  it.each([
    ['a plain password', 'testUser:pass', 'pass'],
    ['a colon in the password', 'testUser:ab:cd', 'ab:cd'],
    ['several colons in the password', 'testUser:ab:cd:ef', 'ab:cd:ef'],
    ['a leading and trailing colon', 'testUser::pw:', ':pw:'],
    ['non-ASCII characters', 'testUser:pässwört', 'pässwört'],
  ])('passes the full password with %s', async (_, credentials, password) => {
    const { req, context } = contextWithHeader(basic(credentials));

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(strategy.validate).toHaveBeenCalledWith('testUser', password);
    expect(req.user).toBe(user);
  });

  it('accepts the scheme case-insensitively', async () => {
    const { context } = contextWithHeader(
      'basic ' + Buffer.from('testUser:pass').toString('base64'),
    );
    await guard.canActivate(context);
    expect(strategy.validate).toHaveBeenCalledWith('testUser', 'pass');
  });

  it.each([
    ['no header', undefined],
    ['a different scheme', 'Bearer some-token'],
    ['no credentials', 'Basic'],
    ['no colon', basic('testUser')],
    ['an empty username', basic(':pass')],
    ['an empty password', basic('testUser:')],
  ])('rejects a request with %s', async (_, header) => {
    const { context } = contextWithHeader(header);

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(strategy.validate).not.toHaveBeenCalled();
  });

  it('rejects when the credentials are invalid', async () => {
    jest
      .spyOn(strategy, 'validate')
      .mockRejectedValue(new UnauthorizedException());
    const { req, context } = contextWithHeader(basic('testUser:wrong'));

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(req.user).toBeUndefined();
  });
});
