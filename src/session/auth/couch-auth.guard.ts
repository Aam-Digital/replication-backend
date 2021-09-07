import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CookieService } from '../cookie/cookie.service';

@Injectable()
export class CouchAuthGuard extends AuthGuard('local') {
  constructor(private cookieService: CookieService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const canActivate = await (super.canActivate(context) as Promise<boolean>);

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const response = context.switchToHttp().getResponse();
    this.cookieService.addResponseCookie(user, response);

    return canActivate;
  }
}
