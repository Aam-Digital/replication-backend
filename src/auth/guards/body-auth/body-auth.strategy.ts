import { Injectable } from '@nestjs/common';
import { UserInfo } from '../../../restricted-endpoints/session/user-auth.dto';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { firstValueFrom } from 'rxjs';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import * as Sentry from '@sentry/node';

/**
 * Authenticate a user from credentials in the body payload of a request.
 *
 * e.g. `{ name: "demo", password: "pass" }`
 */
@Injectable()
export class BodyAuthStrategy extends PassportStrategy(Strategy) {
  constructor(private couchdbService: CouchdbService) {
    super({ usernameField: 'name' });
  }

  async validate(username: string, password: string): Promise<UserInfo> {
    const user = await firstValueFrom(
      this.couchdbService.login(username, password),
    );
    Sentry.setUser({ username: user.name });
    return user;
  }
}
