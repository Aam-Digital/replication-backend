import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { firstValueFrom } from 'rxjs';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { UserInfo } from '../../../restricted-endpoints/session/user-auth.dto';
import { AuthModule } from '../../auth.module';
import { BearerJwtPayload } from '../../jwt-payload.types';

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
      secretOrKey: configService.get<string>(AuthModule.JWT_PUBLIC_KEY)!,
    });
  }

  async validate(data: BearerJwtPayload): Promise<UserInfo> {
    const user = await firstValueFrom(
      this.couchdbService.get('app', data.username),
    ).catch(() => {});
    const projects = Array.isArray(user?.projects)
      ? user.projects.filter((project): project is string => typeof project === 'string')
      : [];

    return new UserInfo(
      data.sub,
      data.username,
      data['_couchdb.roles'],
      projects,
    );
  }
}
