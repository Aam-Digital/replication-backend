import { AuthGuard } from '@nestjs/passport';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { CookieService } from '../../cookie/cookie.service';

/**
 * Use the {@link JwtCookieStrategy} for validation and sets a new user cookie.
 */
@Injectable()
export class JwtCookieGuard extends AuthGuard('jwt-cookie') {
  constructor(private cookieService: CookieService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const res = await (super.canActivate(context) as Promise<boolean>);
    // Renew cookie after every request (too often?)
    this.cookieService.addResponseCookie(context);
    return res;
  }
}
