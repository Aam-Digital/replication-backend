import { Injectable } from '@nestjs/common';
import { User } from './user-auth.dto';

@Injectable()
export class SessionService {
  private loggedInUser: User;

  public login(user: User) {
    this.loggedInUser = user;
  }

  public logout() {
    this.loggedInUser = undefined;
  }

  public isLoggedIn(): boolean {
    return !!this.loggedInUser;
  }

  public getRoles(): string[] {
    return this.loggedInUser?.roles;
  }
}
