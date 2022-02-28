import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CookieService } from '../../cookie/cookie.service';

/**
 * Use the {@link BodyAuthStrategy} for validation and sets a user cookie.
 */
@Injectable()
export class BodyAuthGuard extends AuthGuard('local') {
  constructor(private cookieService: CookieService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const canActivate = await (super.canActivate(context) as Promise<boolean>);
    // Set the cookie after successful authentication
    this.cookieService.addResponseCookie(context);
    return canActivate;
  }
}
