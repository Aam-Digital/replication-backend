import { Injectable } from '@nestjs/common';
import { User } from '../../../restricted-endpoints/session/user-auth.dto';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { CouchdbService } from '../../../restricted-endpoints/couchdb/couchdb.service';
import { firstValueFrom } from 'rxjs';

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

  validate(username: string, password: string): Promise<User> {
    return firstValueFrom(this.couchdbService.login(username, password));
  }
}
