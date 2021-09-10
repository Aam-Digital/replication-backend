import { AuthGuard } from '@nestjs/passport';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { CookieService } from '../cookie/cookie.service';

@Injectable()
export class JwtGuard extends AuthGuard('jwt') {
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
