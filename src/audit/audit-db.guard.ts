import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { isAuditDb } from './audit.config';

/**
 * Rejects any client request whose database (the `:db` route param, or the
 * first path segment) is an audit database (`<db>-audit`).
 *
 * This is the real protection for audit data: the proxy forwards `/:db/...`
 * for any db using admin credentials, so CouchDB-level ACLs would not stop a
 * proxied client — the denylist here does. Registered as a single global guard
 * (via `APP_GUARD`) so no route — `_changes`, `_bulk_get`, `_find`,
 * `_all_docs`, ... — can leak the protection.
 *
 * Internal audit writes via {@link AuditService} bypass this entirely as they
 * call CouchDB directly rather than going through the HTTP routing.
 */
@Injectable()
export class AuditDbGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (isAuditDb(this.extractDbName(request))) {
      throw new ForbiddenException('Access to audit databases is not allowed');
    }
    return true;
  }

  /**
   * Prefer the resolved `:db` route param; fall back to the first path segment
   * for routes that do not declare it.
   */
  private extractDbName(request: Request): string {
    const fromParam = (request.params as { db?: string })?.db;
    if (fromParam) {
      return fromParam;
    }
    const path = (request.path || request.url || '').split('?')[0];
    const segment = path.split('/').filter(Boolean)[0] ?? '';
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  }
}
