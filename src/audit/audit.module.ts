import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { CouchdbService } from '../couchdb/couchdb.service';
import { AuditConfig } from './audit.config';
import { AuditService, DefaultAuditService } from './audit.service';
import { NoopAuditService } from './noop-audit.service';

/**
 * Provides {@link AuditService} for the entity write paths.
 *
 * The implementation is chosen once at startup from the
 * {@link AuditConfig.AUDIT_ENABLED_ENV} flag: {@link DefaultAuditService} when
 * enabled, {@link NoopAuditService} otherwise. The flag is read via
 * {@link ConfigService} in the factory (not `process.env` at import time) so a
 * value from a `.env` file is honoured. Consumers always inject the same
 * {@link AuditService} token and never branch on the flag.
 *
 * Global so the bulk-replication and single-document write paths can record
 * audit entries without each owning module re-importing it. Relies on the
 * (also global) CouchdbModule for database access.
 *
 * Audit records are protected by the permission engine, not a dedicated guard:
 * they are keyed with the `AuditRecord` subject prefix, so a single CASL rule
 * (`{ subject: "AuditRecord", action: "read" }`, granted to privileged roles
 * only) governs them. Reads are filtered by the proxy and any client write is
 * dropped (no rule grants create/update/delete on `AuditRecord`), while the
 * system's own audit writes use admin credentials directly against CouchDB and
 * bypass the permission-checked endpoints.
 */
@Global()
@Module({
  imports: [HttpModule],
  providers: [
    {
      provide: AuditService,
      inject: [ConfigService, CouchdbService],
      useFactory: (
        config: ConfigService,
        couchdb: CouchdbService,
      ): AuditService =>
        config.get<boolean>(AuditConfig.AUDIT_ENABLED_ENV, false)
          ? new DefaultAuditService(couchdb)
          : new NoopAuditService(),
    },
  ],
  exports: [AuditService],
})
export class AuditModule {}
