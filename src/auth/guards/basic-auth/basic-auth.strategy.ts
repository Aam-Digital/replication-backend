import { BasicStrategy as Strategy } from 'passport-http';
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { User } from '../../../restricted-endpoints/session/user-auth.dto';
import { CouchdbAuthService } from '../../couchdb-auth/couchdb-auth.service';

/**
 * Authenticate a user from the BasicAuth header of a request.
 */
@Injectable()
export class BasicAuthStrategy extends PassportStrategy(Strategy) {
  constructor(private couchdbAuth: CouchdbAuthService) {
    super();
  }

  validate(username: string, password: string): Promise<User> {
    return this.couchdbAuth.login(username, password);
  }
}
