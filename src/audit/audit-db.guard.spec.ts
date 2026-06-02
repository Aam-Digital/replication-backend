import { ForbiddenException } from '@nestjs/common';
import { AuditDbGuard } from './audit-db.guard';

function contextFor(request: any) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

it('rejects requests to an audit database (via :db param)', () => {
  const guard = new AuditDbGuard();

  expect(() =>
    guard.canActivate(contextFor({ params: { db: 'app-audit' } })),
  ).toThrow(ForbiddenException);
});

it('rejects audit-db access derived from the path when no :db param', () => {
  const guard = new AuditDbGuard();

  for (const path of [
    '/app-audit/_changes',
    '/app-audit/_find',
    '/app-audit/_bulk_get',
    '/app-audit',
  ]) {
    expect(() => guard.canActivate(contextFor({ params: {}, path }))).toThrow(
      ForbiddenException,
    );
  }
});

it('allows requests to a normal database', () => {
  const guard = new AuditDbGuard();

  expect(guard.canActivate(contextFor({ params: { db: 'app' } }))).toBe(true);
});

it('allows requests to the root path', () => {
  const guard = new AuditDbGuard();

  expect(guard.canActivate(contextFor({ params: {}, path: '/' }))).toBe(true);
});

it('uses the path segment only, ignoring query params', () => {
  const guard = new AuditDbGuard();

  expect(() =>
    guard.canActivate(
      contextFor({ params: {}, url: '/app-audit/_all_docs?include_docs=true' }),
    ),
  ).toThrow(ForbiddenException);
});
