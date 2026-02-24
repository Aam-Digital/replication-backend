import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Filters documents that should not be replicated to/from clients.
 *
 * By default, documents whose IDs start with `_design/` are excluded.
 * This can be overridden via the `REPLICATION_IGNORED_PREFIXES` environment
 * variable (comma-separated list of prefixes). If set to an empty string,
 * filtering is disabled.
 */
@Injectable()
export class DocumentFilterService {
  private static readonly DEFAULT_IGNORED_PREFIXES = ['_design/'];

  private readonly ignoredPrefixes: string[];

  constructor(configService: ConfigService) {
    const envValue = configService.get<string | undefined>(
      'REPLICATION_IGNORED_PREFIXES',
    );
    this.ignoredPrefixes =
      envValue === undefined
        ? DocumentFilterService.DEFAULT_IGNORED_PREFIXES
        : envValue
            .split(',')
            .map((p) => p.trim())
            .filter((p) => p.length > 0);
  }

  /**
   * Whether the given document ID is eligible for replication.
   * Returns `false` for IDs that match any ignored prefix.
   */
  isReplicable(docId: string): boolean {
    return !this.ignoredPrefixes.some((prefix) => docId.startsWith(prefix));
  }
}
