import { BasicStrategy as Strategy } from 'passport-http';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { HttpService } from '@nestjs/axios';
import {
  SessionResponse,
  User,
} from '../../../restricted-endpoints/session/user-auth.dto';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, map } from 'rxjs';
import { CouchDBInteracter } from '../../../utils/couchdb-interacter';

@Injectable()
export class BasicAuthStrategy extends PassportStrategy(Strategy) {
  private readonly authServerUrl;
  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    super();
    this.authServerUrl = this.configService.get<string>(
      CouchDBInteracter.DATABASE_URL_ENV,
    );
  }
  validate(username: string, password: string): Promise<User> {
    return firstValueFrom(
      this.httpService
        .get<SessionResponse>(`${this.authServerUrl}/_session`, {
          auth: {
            username: username,
            password: password,
          },
        })
        .pipe(map((res) => res.data.userCtx)),
    ).catch(() => {
      throw new UnauthorizedException();
    });
  }
}
