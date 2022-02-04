import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { Injectable } from '@nestjs/common';
import { AuthModule } from '../../auth.module';
import { User } from '../../../restricted-endpoints/session/user-auth.dto';
import { TOKEN_KEY } from '../../cookie/cookie.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: (req) => req?.cookies[TOKEN_KEY],
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(AuthModule.JWT_SECRET_ENV),
    });
  }

  async validate(data: any): Promise<User> {
    return new User(data.name, data.sub);
  }
}
