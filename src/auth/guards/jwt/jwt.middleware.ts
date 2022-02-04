import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtGuard } from './jwt.guard';
import { CookieService } from '../../cookie/cookie.service';

@Injectable()
export class JwtMiddleware implements NestMiddleware {
  readonly jwtGuard: JwtGuard;
  constructor(private cookieService: CookieService) {
    this.jwtGuard = new JwtGuard(this.cookieService);

  }
  use(req: any, res: any, next: () => void) {
    return this.jwtGuard
      .canActivate({
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      } as any)
      .then(() => next());
  }
}
