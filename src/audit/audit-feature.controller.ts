import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAuditEnabled } from './audit.config';

/**
 * Public feature-status endpoint for the frontend: reports whether change
 * logging (audit) is enabled on this system, derived from the same
 * `AUDIT_ENABLED` flag that selects the audit service implementation — so the
 * reported state can never drift from the actual recording behavior.
 *
 * Registered in {@link AuditModule}, which is imported before the CouchDB-proxy
 * `/:db` routes in {@link AppModule}, so this literal path wins route matching
 * and is not captured by `/:db/:docId`. No authentication is required: it
 * returns only a non-sensitive boolean feature flag (the auth middleware passes
 * unauthenticated requests through for routes without `@OnlyAuthenticated()`).
 */
@Controller()
export class AuditFeatureController {
  constructor(private readonly config: ConfigService) {}

  @Get('_features/audit')
  getAuditFeature(): { enabled: boolean } {
    return { enabled: isAuditEnabled(this.config) };
  }
}
