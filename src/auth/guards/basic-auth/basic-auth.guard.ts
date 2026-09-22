import { ExecutionContext, Injectable, Optional } from '@nestjs/common';
import { AuthGuard, AuthModuleOptions } from '@nestjs/passport';

/**
 * Use the {@link BasicAuthStrategy} for validation.
 */
@Injectable()
export class BasicAuthGuard extends AuthGuard('basic') {
  constructor(@Optional() options?: AuthModuleOptions) {
    super(options);
  }

  canActivate(context: ExecutionContext): Promise<boolean> {
    return super.canActivate(context) as Promise<boolean>;
  }
}
