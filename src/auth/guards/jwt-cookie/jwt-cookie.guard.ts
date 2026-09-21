import { AuthGuard, AuthModuleOptions } from '@nestjs/passport';
import { ExecutionContext, Injectable, Optional } from '@nestjs/common';
import { CookieService } from '../../cookie/cookie.service';

/**
 * Use the {@link JwtCookieStrategy} for validation and sets a new user cookie.
 */
@Injectable()
export class JwtCookieGuard extends AuthGuard('jwt-cookie') {
  // NestJS v12 no longer inherits @Optional() through subclassing, so this
  // constructor has to redeclare it to keep AuthModuleOptions optional.
  constructor(
    private readonly cookieService: CookieService,
    @Optional() options?: AuthModuleOptions,
  ) {
    super(options);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const res = await (super.canActivate(context) as Promise<boolean>);
    // Renew cookie after every request (too often?)
    this.cookieService.addResponseCookie(context);
    return res;
  }
}
