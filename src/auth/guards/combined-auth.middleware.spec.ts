import { CombinedAuthMiddleware } from './combined-auth.middleware';

describe('CombinedAuthMiddleware', () => {
  it('should be defined', () => {
    expect(new CombinedAuthMiddleware(undefined)).toBeDefined();
  });
});
