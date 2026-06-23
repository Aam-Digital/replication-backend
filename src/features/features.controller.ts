import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAuditEnabled } from '../audit/audit.config';

/**
 * Central, public feature-status endpoint for the frontend: a single
 * `GET /_features` returning a map of which optional features are enabled on
 * this system. New features become new keys here rather than new routes.
 *
 * Each flag is derived from the same config the feature itself uses (e.g.
 * `audit` from {@link isAuditEnabled}), so the reported state can never drift
 * from the actual behavior.
 *
 * The `_` prefix is deliberate: this backend proxies CouchDB at `/:db` and
 * `/:db/:docId`, so a plain `/features` path would be matched as a database
 * named `features`. CouchDB forbids database names starting with `_`, so a
 * `_`-prefixed path can never collide with a real database (the proxy already
 * uses this convention for `_session`, `_changes`, `_all_docs`, …). The module
 * is also imported before {@link RestrictedEndpointsModule} so this literal
 * route registers ahead of the proxy's `:db` routes.
 *
 * No authentication is required: it returns only non-sensitive boolean feature
 * flags (the auth middleware passes unauthenticated requests through for routes
 * without `@OnlyAuthenticated()`).
 */
@Controller()
export class FeaturesController {
  constructor(private readonly config: ConfigService) {}

  @Get('_features')
  getFeatures(): { audit: { enabled: boolean } } {
    return {
      audit: { enabled: isAuditEnabled(this.config) },
    };
  }
}
