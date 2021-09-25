export class UserCredentials {
  name: string;
  password: string;
}

export class User {
  constructor(public name: string, public roles: string[]) {}
}
