import { ConfigService } from '@nestjs/config';
import { AuditConfig, isAuditEnabled } from './audit.config';

// ConfigService.get returns the raw env value, so isAuditEnabled coerces it
// explicitly. These cases live here (not in the controller) because the
// string/boolean handling is the config helper's responsibility.
function configWith(value: unknown): ConfigService {
  return {
    get: (key: string) =>
      key === AuditConfig.AUDIT_ENABLED_ENV ? value : undefined,
  } as unknown as ConfigService;
}

it('is enabled when AUDIT_ENABLED is true (boolean)', () => {
  expect(isAuditEnabled(configWith(true))).toBe(true);
});

it("is enabled when AUDIT_ENABLED is the string 'true'", () => {
  expect(isAuditEnabled(configWith('true'))).toBe(true);
});

it("is disabled when AUDIT_ENABLED is the string 'false'", () => {
  expect(isAuditEnabled(configWith('false'))).toBe(false);
});

it('is disabled when AUDIT_ENABLED is unset', () => {
  expect(isAuditEnabled(configWith(undefined))).toBe(false);
});
