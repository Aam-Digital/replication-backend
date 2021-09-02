import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { Injectable } from '@nestjs/common';
import { JWT_SECRET } from '../session.module';
import { User } from '../session/user-auth.dto';

export const TOKEN_KEY = 'access_token';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: (req) => {
        if (req && req.cookies) {
          return req.cookies[TOKEN_KEY];
        }
      },
      ignoreExpiration: false,
      secretOrKey: JWT_SECRET,
    });
  }

  async validate(data: any): Promise<User> {
    return { name: data.name, roles: data.sub };
  }
}
