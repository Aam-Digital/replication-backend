import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '../session/user-auth.dto';
import { Response } from 'express';

export const TOKEN_KEY = 'access_token';
export const COOKIE_EXPIRATION_TIME = 1000 * 60 * 60 * 2; // 2h expiration time
@Injectable()
export class CookieService {

  constructor(private jwtService: JwtService) {}

  addResponseCookie(user: User, response: Response): void {
    const payload = { name: user.name, sub: user.roles };
    const jwtToken = this.jwtService.sign(payload);

    response.cookie(TOKEN_KEY, jwtToken, {
      httpOnly: true,
      expires: new Date(Date.now() + COOKIE_EXPIRATION_TIME),
    })
  }
}

