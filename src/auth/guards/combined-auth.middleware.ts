import { ExecutionContext, Injectable, NestMiddleware } from '@nestjs/common';
import { BasicAuthGuard } from './basic-auth/basic-auth.guard';
import { JwtCookieGuard } from './jwt/jwt-cookie.guard';
import { JwtBearerGuard } from './jwt-bearer/jwt-bearer.guard';
import { CookieService } from '../cookie/cookie.service';
import * as Sentry from '@sentry/node';

/**
 * This middleware allows users to use multiple alternative authentication modes.
 * If one mode fails the system tries to fall back on other modes.
 *
 * The modes are checked in the following order and processing stops once the first one validates successfully:
 * 1. Basic Auth
 * 2. Cookie
 * 3. Bearer
 */
@Injectable()
export class CombinedAuthMiddleware implements NestMiddleware {
  private basicAuthGuard: BasicAuthGuard;
  private jwtCookieGuard: JwtCookieGuard;
  private jwtBearerGuard: JwtBearerGuard;

  constructor(private cookieService: CookieService) {
    this.basicAuthGuard = new BasicAuthGuard();
    this.jwtCookieGuard = new JwtCookieGuard(cookieService);
    this.jwtBearerGuard = new JwtBearerGuard();
  }

  use(req: any, res: any, next: () => void) {
    // TODO this can probably be prettier
    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as ExecutionContext;
    return this.basicAuthGuard
      .canActivate(context)
      .catch(() => this.jwtCookieGuard.canActivate(context))
      .catch(() => this.jwtBearerGuard.canActivate(context))
      .then(() => Sentry.setUser({ username: req.user.name }))
      .then(() => next());
  }
}
