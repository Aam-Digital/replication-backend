import { AuthGuard } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

/**
 * Use the {@link JwtBearerStrategy} for validation.
 */
@Injectable()
export class JwtBearerGuard extends AuthGuard('jwt-bearer') {}
