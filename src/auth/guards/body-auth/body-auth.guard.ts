import { ExecutionContext, Injectable, Optional } from '@nestjs/common';
import { AuthGuard, AuthModuleOptions } from '@nestjs/passport';
import { CookieService } from '../../cookie/cookie.service';

/**
 * Use the {@link BodyAuthStrategy} for validation and sets a user cookie.
 */
@Injectable()
export class BodyAuthGuard extends AuthGuard('local') {
  // NestJS v12 no longer inherits @Optional() through subclassing, so this
  // constructor has to redeclare it to keep AuthModuleOptions optional.
  constructor(
    private readonly cookieService: CookieService,
    @Optional() options?: AuthModuleOptions,
  ) {
    super(options);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const canActivate = await (super.canActivate(context) as Promise<boolean>);
    // Set the cookie after successful authentication
    this.cookieService.addResponseCookie(context);
    return canActivate;
  }
}
