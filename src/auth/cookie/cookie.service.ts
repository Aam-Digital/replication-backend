import { ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';

export const TOKEN_KEY = 'access_token';
export const COOKIE_EXPIRATION_TIME = 1000 * 60 * 60 * 2; // 2h expiration time

/**
 * Utility service to create cookies after the authentication process
 * containing our application specific user details.
 */
@Injectable()
export class CookieService {
  constructor(private jwtService: JwtService) {}

  addResponseCookie(context: ExecutionContext): void {
    const request = context.switchToHttp().getRequest();
    const user = request.user as UserInfo;
    const response = context.switchToHttp().getResponse();

    // TODO align structure with CouchDB's JWT structure
    const payload = { name: user.name, sub: user.roles };
    const jwtToken = this.jwtService.sign(payload);

    response.cookie(TOKEN_KEY, jwtToken, {
      httpOnly: true,
      expires: new Date(Date.now() + COOKIE_EXPIRATION_TIME),
    });
  }
}
