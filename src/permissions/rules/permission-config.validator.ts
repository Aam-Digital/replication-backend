import { RulesConfig } from './permission';

export class PermissionConfigValidator {
  /**
   * Keep validation intentionally minimal: non-null object and not an array.
   * Detailed schema validation is intentionally out of scope for now.
   */
  static isValidRulesConfig(data: unknown): data is RulesConfig {
    return typeof data === 'object' && data !== null && !Array.isArray(data);
  }

  static hasRole(config: RulesConfig, role: string): boolean {
    return Object.hasOwn(config, role);
  }
}
