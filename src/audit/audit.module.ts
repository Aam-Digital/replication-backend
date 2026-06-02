import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { HttpModule } from '@nestjs/axios';
import { AuditService } from './audit.service';
import { AuditDbGuard } from './audit-db.guard';

/**
 * Provides {@link AuditService} for the entity write paths and registers the
 * global {@link AuditDbGuard} that denies client access to `<db>-audit` dbs.
 *
 * Global so the bulk-replication and single-document write paths can record
 * audit entries without each owning module re-importing it. Relies on the
 * (also global) CouchdbModule for database access.
 */
@Global()
@Module({
  imports: [HttpModule],
  providers: [
    AuditService,
    { provide: APP_GUARD, useClass: AuditDbGuard },
  ],
  exports: [AuditService],
})
export class AuditModule {}
