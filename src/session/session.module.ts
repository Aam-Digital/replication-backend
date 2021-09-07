import { Module } from '@nestjs/common';
import { SessionController } from './session/session.controller';
import { CouchAuthStrategy } from './auth/couch-auth.strategy';
import { HttpModule } from '@nestjs/axios';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt/jwt.strategy';
import { COOKIE_EXPIRATION_TIME, CookieService } from './cookie/cookie.service';

// TODO move to env
export const JWT_SECRET = 'someSecret';

@Module({
  imports: [
    HttpModule,
    PassportModule,
    JwtModule.register({
      secret: JWT_SECRET,
      signOptions: {
        expiresIn: COOKIE_EXPIRATION_TIME,
      },
    }),
  ],
  controllers: [SessionController],
  providers: [CouchAuthStrategy, JwtStrategy, CookieService],
  exports: [CookieService],
})
export class SessionModule {}
