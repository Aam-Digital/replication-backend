import { ConfigService } from '@nestjs/config';
import { AuditFeatureController } from './audit-feature.controller';
import { AuditConfig } from './audit.config';

function controllerWith(auditEnabledValue: unknown): AuditFeatureController {
  const config = {
    get: (key: string) =>
      key === AuditConfig.AUDIT_ENABLED_ENV ? auditEnabledValue : undefined,
  } as unknown as ConfigService;
  return new AuditFeatureController(config);
}

it('reports enabled=true when AUDIT_ENABLED is true (boolean)', () => {
  expect(controllerWith(true).getAuditFeature()).toEqual({ enabled: true });
});

it("reports enabled=true when AUDIT_ENABLED is the string 'true'", () => {
  expect(controllerWith('true').getAuditFeature()).toEqual({ enabled: true });
});

it("reports enabled=false when AUDIT_ENABLED is the string 'false'", () => {
  expect(controllerWith('false').getAuditFeature()).toEqual({ enabled: false });
});

it('reports enabled=false when AUDIT_ENABLED is unset', () => {
  expect(controllerWith(undefined).getAuditFeature()).toEqual({
    enabled: false,
  });
});
