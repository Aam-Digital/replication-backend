import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Decorator to get user object in an authenticated request
 */
export const User = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest().user,
);
