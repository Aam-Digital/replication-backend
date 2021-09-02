import { Body, Controller, Post } from '@nestjs/common';
import { UserCredentials, UserResponse } from './user-auth.dto';
import { map, Observable } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { COUCH_ENDPOINT } from '../../app.module';

@Controller()
export class SessionController {
  constructor(private httpService: HttpService) { }
  /**
   * Login endpoint.
   * Saves username and password and authenticates against the database.
   * @param credentials
   */
  @Post('/_session')
  session(@Body() credentials: UserCredentials): Observable<UserResponse> {
    return this.httpService
      .post(`${COUCH_ENDPOINT}/_session`, credentials)
      .pipe(map((response) => response.data));
  }
}
