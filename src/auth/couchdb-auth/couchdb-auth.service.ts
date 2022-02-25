import { Injectable, UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { CouchDBInteracter } from '../../utils/couchdb-interacter';
import {
  SessionResponse,
  User,
} from '../../restricted-endpoints/session/user-auth.dto';
import { firstValueFrom, map } from 'rxjs';

/**
 * Authenticate user credentials via a CouchDB server.
 */
@Injectable()
export class CouchdbAuthService {
  private readonly authServerUrl;

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    this.authServerUrl = this.configService.get<string>(
      CouchDBInteracter.DATABASE_URL_ENV,
    );
  }

  login(username: string, password: string): Promise<User> {
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
