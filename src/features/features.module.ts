import { Module } from '@nestjs/common';
import { FeaturesController } from './features.controller';

/**
 * Hosts the central {@link FeaturesController} (`GET /_features`).
 *
 * Imported before {@link RestrictedEndpointsModule} in {@link AppModule} so the
 * literal `_features` route registers ahead of the CouchDB-proxy `:db` routes.
 * `ConfigService` is available via the global `ConfigModule`; feature flags are
 * read directly from their owning module's config helpers (e.g. the audit flag
 * via `isAuditEnabled`). When a second feature needs to register dynamically, a
 * DI multi-provider can replace the direct lookups — unnecessary for a single
 * flag today.
 */
@Module({
  controllers: [FeaturesController],
})
export class FeaturesModule {}
