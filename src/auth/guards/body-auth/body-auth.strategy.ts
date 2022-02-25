import { Injectable } from '@nestjs/common';
import { User } from '../../../restricted-endpoints/session/user-auth.dto';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { CouchdbAuthService } from '../../couchdb-auth/couchdb-auth.service';

/**
 * Authenticate a user from credentials in the body payload of a request.
 *
 * e.g. `{ name: "demo", password: "pass" }`
 */
@Injectable()
export class BodyAuthStrategy extends PassportStrategy(Strategy) {
  constructor(private couchdbAuth: CouchdbAuthService) {
    super({ usernameField: 'name' });
  }

  validate(username: string, password: string): Promise<User> {
    return this.couchdbAuth.login(username, password);
  }
}
