import { AuthGuard, AuthModuleOptions } from '@nestjs/passport';
import { ExecutionContext, Injectable, Optional } from '@nestjs/common';

/**
 * Use the {@link JwtBearerStrategy} for validation.
 */
@Injectable()
export class JwtBearerGuard extends AuthGuard('jwt-bearer') {
  constructor(@Optional() options?: AuthModuleOptions) {
    super(options);
  }

  canActivate(context: ExecutionContext): Promise<boolean> {
    return super.canActivate(context) as Promise<boolean>;
  }
}
