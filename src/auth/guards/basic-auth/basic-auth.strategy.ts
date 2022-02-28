import { BasicStrategy as Strategy } from 'passport-http';
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { User } from '../../../restricted-endpoints/session/user-auth.dto';
import { firstValueFrom } from 'rxjs';
import { CouchdbService } from '../../../couchdb/couchdb.service';

/**
 * Authenticate a user from the BasicAuth header of a request.
 */
@Injectable()
export class BasicAuthStrategy extends PassportStrategy(Strategy) {
  constructor(private couchdbService: CouchdbService) {
    super();
  }

  validate(username: string, password: string): Promise<User> {
    return firstValueFrom(this.couchdbService.login(username, password));
  }
}
