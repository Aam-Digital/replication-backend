import { ExecutionContext, Injectable, NestMiddleware } from '@nestjs/common';
import { BasicAuthGuard } from './basic-auth/basic-auth-guard.service';
import { JwtGuard } from './jwt/jwt.guard';
import { CookieService } from '../cookie/cookie.service';

/**
 * This middleware allows users to use multiple alternative authentication modes.
 * If one mode fails the system tries to fall back on another modes.
 */
@Injectable()
export class CombinedAuthMiddleware implements NestMiddleware {
  private basicAuthGuard: BasicAuthGuard;
  private jwtGuard: JwtGuard;

  constructor(private cookieService: CookieService) {
    this.basicAuthGuard = new BasicAuthGuard();
    this.jwtGuard = new JwtGuard(cookieService);
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
      .catch(() => this.jwtGuard.canActivate(context))
      .then(() => next());
  }
}
