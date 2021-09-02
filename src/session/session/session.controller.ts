import { Body, Controller, Post } from '@nestjs/common';
import { UserCredentials, User } from './user-auth.dto';
import { map, Observable, tap } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { COUCH_ENDPOINT } from '../../app.module';
import { SessionService } from './session.service';

@Controller()
export class SessionController {
  constructor(
    private httpService: HttpService,
    private sessionService: SessionService,
  ) {}
  /**
   * Login endpoint.
   * Saves username and password and authenticates against the database.
   * @param credentials
   */
  @Post('/_session')
  session(@Body() credentials: UserCredentials): Observable<User> {
    return this.httpService
      .post(`${COUCH_ENDPOINT}/_session`, credentials)
      .pipe(
        map((response) => response.data),
        tap((user) => this.sessionService.login(user)),
      );
  }
}
