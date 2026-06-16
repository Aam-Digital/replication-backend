import { Injectable } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * No-op {@link AuditService} wired by {@link AuditModule} when the audit feature
 * is disabled. Every method does nothing, so the write paths can call the
 * service unconditionally without knowing whether auditing is on.
 *
 * Because it extends the abstract {@link AuditService}, any method added to the
 * contract must be given a (no-op) implementation here too — the compiler
 * enforces it.
 */
@Injectable()
export class NoopAuditService extends AuditService {
  async record(): Promise<void> {
    // intentionally empty: auditing disabled
  }

  async recordBulkWrite(): Promise<void> {
    // intentionally empty: auditing disabled
  }
}
