import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable } from '@nestjs/common';
import { UserInfo } from '../../../restricted-endpoints/session/user-auth.dto';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../../auth.module';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { firstValueFrom } from 'rxjs';

/**
 * Authenticate a user with a foreign bearer JWT using the {@link AuthModule.JWT_PUBLIC_KEY}.
 */
@Injectable()
export class JwtBearerStrategy extends PassportStrategy(
  Strategy,
  'jwt-bearer',
) {
  constructor(
    configService: ConfigService,
    private couchdbService: CouchdbService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.get<string>(AuthModule.JWT_PUBLIC_KEY),
    });
  }

  async validate(data: any): Promise<UserInfo> {
    const user = await firstValueFrom(
      this.couchdbService.get('app', data['username']),
    ).catch(() => {});

    //TODO
    return new UserInfo(
      data.username,
      data['_couchdb.roles'],
      user && user['projects'] ? user['projects'] : [],
    );
  }
}
