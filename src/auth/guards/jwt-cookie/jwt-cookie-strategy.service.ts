import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { firstValueFrom } from 'rxjs';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { UserInfo } from '../../../restricted-endpoints/session/user-auth.dto';
import { AuthModule } from '../../auth.module';
import { TOKEN_KEY } from '../../cookie/cookie.service';
import { CookieJwtPayload } from '../../jwt-payload.types';

/**
 * Authenticate a user using an existing JWT from a cookie in the request.
 */
@Injectable()
export class JwtCookieStrategy extends PassportStrategy(
  Strategy,
  'jwt-cookie',
) {
  constructor(
    configService: ConfigService,
    private couchdbService: CouchdbService,
  ) {
    super({
      jwtFromRequest: (req: Request) => req?.cookies[TOKEN_KEY],
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(AuthModule.JWT_SECRET_ENV)!,
    });
  }

  async validate(data: CookieJwtPayload): Promise<UserInfo> {
    const user = await firstValueFrom(
      this.couchdbService.get('app', data.name),
    ).catch(() => {});
    const projects = Array.isArray(user?.projects)
      ? user.projects.filter((project): project is string => typeof project === 'string')
      : [];

    return new UserInfo(
      data.sub,
      data.name,
      data.roles,
      projects,
    );
  }
}
