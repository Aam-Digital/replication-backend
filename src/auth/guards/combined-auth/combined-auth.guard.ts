import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import { BasicAuthGuard } from '../basic-auth/basic-auth.guard';
import { JwtBearerGuard } from '../jwt-bearer/jwt-bearer.guard';
import { JwtCookieGuard } from '../jwt-cookie/jwt-cookie.guard';
import * as Sentry from '@sentry/node';
import { ONLY_AUTHENTICATED_KEY } from '../../only-authenticated.decorator';
import { Reflector } from '@nestjs/core';

/**
 * This can be used as middleware or guard.
 * It allows users to use multiple alternative authentication modes.
 * If one mode fails the system tries to fall back on other modes.
 *
 * The modes are checked in the following order and processing stops once the first one validates successfully:
 * 1. Basic - using CouchDB
 * 2. Cookie - using the JWT_SECRET env
 * 3. Bearer - using the JWT_PUBLIC_KEY env
 *
 * On default, the guard always passes, but might set `undefined` as the user object.
 * To change this behavior and return a `401` if a user is not authenticated
 * use the `@OnlyAuthenticated()` decorator on a method or class level.
 *
 * The middleware always throws an exception if the request is unauthenticated.
 *
 */
@Injectable()
export class CombinedAuthGuard implements CanActivate, NestMiddleware {
  constructor(
    private basicAuthGuard: BasicAuthGuard,
    private jwtCookieGuard: JwtCookieGuard,
    private jwtBearerGuard: JwtBearerGuard,
    private reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): Promise<boolean> {
    const onlyAuthenticated = this.reflector.getAllAndOverride(
      ONLY_AUTHENTICATED_KEY,
      [context.getHandler(), context.getClass()],
    );
    const req = context.switchToHttp().getRequest();
    return this.authenticateViaGuards(context)
      .then((res) => {
        Sentry.setUser({ username: req.user.name });
        return res;
      })
      .catch((err) => {
        if (onlyAuthenticated) {
          throw err;
        } else {
          req.user = undefined;
          return true;
        }
      });
  }

  use(req: any, res: any, next: () => void) {
    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as ExecutionContext;
    return this.authenticateViaGuards(context)
      .then(() => Sentry.setUser({ username: req.user.name }))
      .then(() => next());
  }

  private authenticateViaGuards(context: ExecutionContext): Promise<boolean> {
    return this.basicAuthGuard
      .canActivate(context)
      .catch(() => this.jwtCookieGuard.canActivate(context))
      .catch(() => this.jwtBearerGuard.canActivate(context));
  }
}
