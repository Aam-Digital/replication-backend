import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable } from '@nestjs/common';
import { User } from '../../../restricted-endpoints/session/user-auth.dto';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../../auth.module';

/**
 * Authenticate a user with a foreign bearer JWT using the {@link AuthModule.JWT_PUBLIC_KEY}.
 */
@Injectable()
export class JwtBearerStrategy extends PassportStrategy(
  Strategy,
  'jwt-bearer',
) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.get<string>(AuthModule.JWT_PUBLIC_KEY),
    });
  }

  async validate(data: any): Promise<User> {
    return new User(data.username, data['_couchdb.roles']);
  }
}
