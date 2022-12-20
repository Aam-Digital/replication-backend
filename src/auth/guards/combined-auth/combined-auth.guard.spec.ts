import { CombinedAuthGuard } from './combined-auth.guard';

describe('CombinedAuthGuard', () => {
  it('should be defined', () => {
    expect(new CombinedAuthGuard(undefined)).toBeDefined();
  });
});
