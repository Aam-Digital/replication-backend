import { ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '../../restricted-endpoints/session/user-auth.dto';

export const TOKEN_KEY = 'AuthSession';
export const COOKIE_EXPIRATION_TIME = 1000 * 60 * 60 * 2; // 2h expiration time

@Injectable()
export class CookieService {
  constructor(private jwtService: JwtService) {}

  addResponseCookie(context: ExecutionContext): void {
    const request = context.switchToHttp().getRequest();
    const user = request.user as User;
    const response = context.switchToHttp().getResponse();

    const payload = { name: user.name, sub: user.roles };
    const jwtToken = this.jwtService.sign(payload);

    response.cookie(TOKEN_KEY, jwtToken, {
      httpOnly: true,
      expires: new Date(Date.now() + COOKIE_EXPIRATION_TIME),
    });
  }
}
