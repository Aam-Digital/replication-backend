import { Injectable } from '@nestjs/common';
import { User } from './user-auth.dto';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class SessionService {
  private loggedInUser: User;

  constructor(private jwtService: JwtService) {}

  /**
   * Stores the user and returns a JWT token
   * @param user
   */
  public login(user: User): string {
    this.loggedInUser = user;

    const payload = { name: user.name, sub: user.roles };
    return this.jwtService.sign(payload);
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
