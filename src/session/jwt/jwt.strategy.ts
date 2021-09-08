import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { Injectable } from '@nestjs/common';
import { SessionModule } from '../session.module';
import { User } from '../session/user-auth.dto';
import { TOKEN_KEY } from '../cookie/cookie.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: (req) => req?.cookies[TOKEN_KEY],
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(SessionModule.JWT_SECRET_ENV),
    });
  }

  async validate(data: any): Promise<User> {
    return { name: data.name, roles: data.sub };
  }
}
