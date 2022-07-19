import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable } from '@nestjs/common';
import { AuthModule } from '../../auth.module';
import { User } from '../../../restricted-endpoints/session/user-auth.dto';
import { TOKEN_KEY } from '../../cookie/cookie.service';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';

/**
 * Authenticate a user using an existing JWT from a cookie in the request.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: (req) => {
        const token =
          req?.cookies[TOKEN_KEY] ||
          ExtractJwt.fromAuthHeaderAsBearerToken()(req);
        console.log('token', token);
        return token;
      },
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(AuthModule.JWT_SECRET_ENV),
    });
  }

  async validate(data: any): Promise<User> {
    const user = new User(data.name, data.sub);
    Sentry.setUser({ username: user.name });
    return user;
  }
}
