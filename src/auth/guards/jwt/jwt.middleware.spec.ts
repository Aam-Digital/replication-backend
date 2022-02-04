import { JwtMiddleware } from './jwt.middleware';

describe('JwtMiddleware', () => {
  it('should be defined', () => {
    expect(new JwtMiddleware(undefined)).toBeDefined();
  });
});
