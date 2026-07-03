import { BasicStrategy as Strategy } from 'passport-http';
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { UserInfo } from '../../../restricted-endpoints/session/user-auth.dto';
import { firstValueFrom } from 'rxjs';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { setUser } from '@sentry/node';
import { createHash } from 'crypto';

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

  private readonly loginCache = new Map<
    string,
    { user: UserInfo; expiresAtMs: number }
  >();

  constructor(private couchdbService: CouchdbService) {
    super();
  }

  async validate(username: string, password: string): Promise<UserInfo> {
    const key = this.cacheKey(username, password);
    const cached = this.loginCache.get(key);
    if (cached) {
      if (cached.expiresAtMs > Date.now()) {
        setUser({ username: cached.user.name });
        return cached.user;
      }
      this.loginCache.delete(key); // drop the expired entry
    }

    // failed logins throw here and are never cached
    const user = await firstValueFrom(
      this.couchdbService.login(username, password),
    );

    this.evictIfNeeded();
    this.loginCache.set(key, {
      user,
      expiresAtMs: Date.now() + BasicAuthStrategy.LOGIN_CACHE_TTL_MS,
    });

    setUser({ username: user.name });
    return user;
  }

  /**
   * Keep the cache bounded: drop expired entries first, then evict the oldest
   * live ones (Map preserves insertion order) — so exceeding the cap degrades
   * the coldest entries instead of wiping every warm one.
   */
  private evictIfNeeded(): void {
    if (this.loginCache.size < BasicAuthStrategy.LOGIN_CACHE_MAX_ENTRIES) {
      return;
    }
    const now = Date.now();
    for (const [key, entry] of this.loginCache) {
      if (entry.expiresAtMs <= now) {
        this.loginCache.delete(key);
      }
    }
    while (this.loginCache.size >= BasicAuthStrategy.LOGIN_CACHE_MAX_ENTRIES) {
      const oldest = this.loginCache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.loginCache.delete(oldest);
    }
  }

  /** never store plaintext credentials — key entries on a digest */
  private cacheKey(username: string, password: string): string {
    return createHash('sha256').update(`${username}:${password}`).digest('hex');
  }
}
