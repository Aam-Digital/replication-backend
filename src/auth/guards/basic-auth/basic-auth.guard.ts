import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Use the {@link BasicAuthStrategy} for validation.
 */
@Injectable()
export class BasicAuthGuard extends AuthGuard('basic') {
  canActivate(context: ExecutionContext): Promise<boolean> {
    return super.canActivate(context) as Promise<boolean>;
  }
}
