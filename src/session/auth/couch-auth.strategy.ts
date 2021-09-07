import { Injectable, UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, map } from 'rxjs';
import { User } from '../session/user-auth.dto';
import { COUCH_ENDPOINT } from '../../app.module';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';

@Injectable()
export class CouchAuthStrategy extends PassportStrategy(Strategy) {
  constructor(private httpService: HttpService) {
    super({ usernameField: 'name' });
  }

  validate(username: string, password: string): Promise<User> {
    return firstValueFrom(
      this.httpService
        .post<User>(`${COUCH_ENDPOINT}/_session`, {
          name: username,
          password: password,
        })
        .pipe(map((response) => response.data)),
    ).catch(() => {
      throw new UnauthorizedException();
    });
  }
}
