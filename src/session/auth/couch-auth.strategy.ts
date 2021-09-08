import { Injectable, UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, map } from 'rxjs';
import { User } from '../session/user-auth.dto';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { ConfigService } from '@nestjs/config';
import { CouchProxyController } from '../../couch-proxy/couch-proxy.controller';

@Injectable()
export class CouchAuthStrategy extends PassportStrategy(Strategy) {
  readonly authServerUrl: string;

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    super({ usernameField: 'name' });
    this.authServerUrl = this.configService.get<string>(
      CouchProxyController.DATABASE_URL_ENV,
    );
  }

  validate(username: string, password: string): Promise<User> {
    return firstValueFrom(
      this.httpService
        .post<User>(`${this.authServerUrl}/_session`, {
          name: username,
          password: password,
        })
        .pipe(map((response) => response.data)),
    ).catch(() => {
      throw new UnauthorizedException();
    });
  }
}
