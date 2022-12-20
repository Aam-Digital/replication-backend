import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { CookieService } from '../../cookie/cookie.service';
import { BasicAuthGuard } from '../basic-auth/basic-auth.guard';
import { JwtBearerGuard } from '../jwt-bearer/jwt-bearer.guard';
import { JwtCookieGuard } from '../jwt-cookie/jwt-cookie.guard';
import * as Sentry from '@sentry/node';
import { ONLY_AUTHENTICATED_KEY } from '../../only-authenticated.decorator';
import { Reflector } from '@nestjs/core';

/**
 * This guard combines basic, cookie and bearer auth.
 * On default, it always passes, but might set `undefined` as the user object.
 *
 * To change this behavior and return a `401` if a user is not authenticated
 * use the `@OnlyAuthenticated()` decorator on a method or class level.
 */
@Injectable()
export class CombinedAuthGuard implements CanActivate {
  private basicAuthGuard = new BasicAuthGuard();
  private jwtCookieGuard = new JwtCookieGuard(this.cookieService);
  private jwtBearerGuard = new JwtBearerGuard();

  constructor(
    private cookieService: CookieService,
    private reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): Promise<boolean> {
    const onlyAuthenticated = this.reflector.getAllAndOverride(
      ONLY_AUTHENTICATED_KEY,
      [context.getHandler(), context.getClass()],
    );
    const req = context.switchToHttp().getRequest();
    return this.basicAuthGuard
      .canActivate(context)
      .catch(() => this.jwtCookieGuard.canActivate(context))
      .catch(() => this.jwtBearerGuard.canActivate(context))
      .then((res) => {
        Sentry.setUser({ username: req.user.name });
        return res;
      })
      .catch(() => {
        if (onlyAuthenticated) {
          return false;
        } else {
          req.user = undefined;
          return true;
        }
      });
  }
}
