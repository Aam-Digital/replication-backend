import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { Injectable } from '@nestjs/common';
import { AuthModule } from '../../auth.module';
import { UserInfo } from '../../../restricted-endpoints/session/user-auth.dto';
import { TOKEN_KEY } from '../../cookie/cookie.service';
import { ConfigService } from '@nestjs/config';

/**
 * Authenticate a user using an existing JWT from a cookie in the request.
 */
@Injectable()
export class JwtCookieStrategy extends PassportStrategy(
  Strategy,
  'jwt-cookie',
) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: (req) => req?.cookies[TOKEN_KEY],
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(AuthModule.JWT_SECRET_ENV),
    });
  }

  async validate(data: any): Promise<UserInfo> {
    return new UserInfo(data.name, data.sub);
  }
}
