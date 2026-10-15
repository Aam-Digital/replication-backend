import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { UserInfo } from '../../../restricted-endpoints/session/user-auth.dto';
import { BasicAuthStrategy } from './basic-auth.strategy';

/**
 * Authenticate a request from its Basic `Authorization` header,
 * validating the credentials with {@link BasicAuthStrategy}.
 */
@Injectable()
export class BasicAuthGuard implements CanActivate {
  constructor(private readonly basicAuthStrategy: BasicAuthStrategy) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: UserInfo }>();
    const credentials = parseBasicAuthHeader(req.headers?.authorization);
    if (!credentials) {
      throw new UnauthorizedException();
    }
    req.user = await this.basicAuthStrategy.validate(
      credentials.username,
      credentials.password,
    );
    return true;
  }
}

/**
 * Split at the first colon only: RFC 7617 forbids a colon in the user-id,
 * but the password may contain any number of them.
 */
export function parseBasicAuthHeader(
  header: string | undefined,
): { username: string; password: string } | undefined {
  const match = /^Basic\s+(\S+)\s*$/i.exec(header ?? '');
  if (!match) {
    return undefined;
  }
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) {
    return undefined;
  }
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  if (!username || !password) {
    return undefined;
  }
  return { username, password };
}
