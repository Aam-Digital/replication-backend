import { BasicStrategy as Strategy } from 'passport-http';
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { User } from '../../../restricted-endpoints/session/user-auth.dto';
import { firstValueFrom } from 'rxjs';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import * as Sentry from '@sentry/node';

/**
 * Authenticate a user from the BasicAuth header of a request.
 */
@Injectable()
export class BasicAuthStrategy extends PassportStrategy(Strategy) {
  constructor(private couchdbService: CouchdbService) {
    super();
  }

  async validate(username: string, password: string): Promise<User> {
    const user = await firstValueFrom(
      this.couchdbService.login(username, password),
    );
    Sentry.setUser({ username: user.name });
    return user;
  }
}
