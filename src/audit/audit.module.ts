import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuditService } from './audit.service';

/**
 * Provides {@link AuditService} for the entity write paths.
 *
 * Global so the bulk-replication and single-document write paths can record
 * audit entries without each owning module re-importing it. Relies on the
 * (also global) CouchdbModule for database access.
 *
 * Audit records are protected by the permission engine, not a dedicated guard:
 * they are keyed with the `ChangeAudit` subject prefix, so a single CASL rule
 * (`{ subject: "ChangeAudit", action: "read" }`, granted to privileged roles
 * only) governs them. Reads are filtered by the proxy and any client write is
 * dropped (no rule grants create/update/delete on `ChangeAudit`), while the
 * system's own audit writes use admin credentials directly against CouchDB and
 * bypass the permission-checked endpoints.
 */
@Global()
@Module({
  imports: [HttpModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
