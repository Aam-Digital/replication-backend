import { AuthGuard } from '@nestjs/passport';
import { ExecutionContext, Injectable } from '@nestjs/common';

/**
 * Use the {@link JwtBearerStrategy} for validation.
 */
@Injectable()
export class JwtBearerGuard extends AuthGuard('jwt-bearer') {
  canActivate(context: ExecutionContext): Promise<boolean> {
    return super.canActivate(context) as Promise<boolean>;
  }
}
