export class UserCredentials {
  name: string;
  password: string;
}

export class UserPassword {
  password: string;
}

export class User {
  constructor(public name: string, public roles: string[]) {}
}

export class SessionResponse {
  userCtx: User;
}
