import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { CookieService } from '../../cookie/cookie.service';
import { BasicAuthGuard } from '../basic-auth/basic-auth.guard';
import { JwtBearerGuard } from '../jwt-bearer/jwt-bearer.guard';
import { JwtCookieGuard } from '../jwt-cookie/jwt-cookie.guard';
import * as Sentry from '@sentry/node';

@Injectable()
export class CombinedAuthGuard implements CanActivate {
  private basicAuthGuard = new BasicAuthGuard();
  private jwtCookieGuard = new JwtCookieGuard(this.cookieService);
  private jwtBearerGuard = new JwtBearerGuard();

  constructor(private cookieService: CookieService) {}

  canActivate(context: ExecutionContext): Promise<boolean> {
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
        req.user = undefined;
        return true;
      });
  }
}
