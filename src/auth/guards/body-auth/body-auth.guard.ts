import { ExecutionContext, Injectable, Optional } from '@nestjs/common';
import { AuthGuard, AuthModuleOptions } from '@nestjs/passport';
import { CookieService } from '../../cookie/cookie.service';

/**
 * Use the {@link BodyAuthStrategy} for validation and sets a user cookie.
 */
@Injectable()
export class BodyAuthGuard extends AuthGuard('local') {
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
