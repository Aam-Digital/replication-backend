import { AuthGuard, AuthModuleOptions } from '@nestjs/passport';
import { ExecutionContext, Injectable, Optional } from '@nestjs/common';

/**
 * Use the {@link JwtBearerStrategy} for validation.
 */
@Injectable()
export class JwtBearerGuard extends AuthGuard('jwt-bearer') {
  // NestJS v12 no longer inherits @Optional() through subclassing, so this
  // constructor has to redeclare it to keep AuthModuleOptions optional.
  constructor(@Optional() options?: AuthModuleOptions) {
    super(options);
  }

  canActivate(context: ExecutionContext): Promise<boolean> {
    return super.canActivate(context) as Promise<boolean>;
  }
}
