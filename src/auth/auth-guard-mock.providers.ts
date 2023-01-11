import { BasicAuthGuard } from './guards/basic-auth/basic-auth.guard';
import { JwtCookieGuard } from './guards/jwt-cookie/jwt-cookie.guard';
import { JwtBearerGuard } from './guards/jwt-bearer/jwt-bearer.guard';

export const authGuardMockProviders = [
  { provide: BasicAuthGuard, useValue: {} },
  { provide: JwtCookieGuard, useValue: {} },
  { provide: JwtBearerGuard, useValue: {} },
];
