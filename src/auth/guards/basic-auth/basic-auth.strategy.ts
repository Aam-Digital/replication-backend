import { BasicStrategy as Strategy } from 'passport-http';
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { UserInfo } from '../../../restricted-endpoints/session/user-auth.dto';
import { firstValueFrom } from 'rxjs';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { setUser } from '@sentry/node';
import { createHash } from 'crypto';
import { TtlCache } from '../../../common/ttl-cache';

/**
 * Authenticate a user from the BasicAuth header of a request.
 *
 * Successful logins are cached for a short time so that request bursts
 * (e.g. during replication) do not trigger a CouchDB `_session` round trip
 * — and the password hash verification inside CouchDB — for every request.
 */
@Injectable()
export class BasicAuthStrategy extends PassportStrategy(Strategy) {
  /** how long a successful login is reused without re-checking with CouchDB */
  static readonly LOGIN_CACHE_TTL_MS = 60_000;
  /** safety cap to bound memory use */
  static readonly LOGIN_CACHE_MAX_ENTRIES = 1000;

  private readonly loginCache = new TtlCache<UserInfo>(
    BasicAuthStrategy.LOGIN_CACHE_TTL_MS,
    BasicAuthStrategy.LOGIN_CACHE_MAX_ENTRIES,
  );

  constructor(private couchdbService: CouchdbService) {
    super();
  }

  async validate(username: string, password: string): Promise<UserInfo> {
    const key = this.cacheKey(username, password);
    const cached = this.loginCache.get(key);
    if (cached) {
      setUser({ username: cached.name });
      return cached;
    }

    // failed logins throw here and are never cached
    const user = await firstValueFrom(
      this.couchdbService.login(username, password),
    );

    this.loginCache.set(key, user);

    setUser({ username: user.name });
    return user;
  }

  /** never store plaintext credentials — key entries on a digest */
  private cacheKey(username: string, password: string): string {
    return createHash('sha256').update(`${username}:${password}`).digest('hex');
  }
}
