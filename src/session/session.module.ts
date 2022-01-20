import { Module } from '@nestjs/common';
import { SessionController } from './session/session.controller';
import { CouchAuthStrategy } from './guards/session-auth/couch-auth.strategy';
import { HttpModule } from '@nestjs/axios';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './guards/jwt/jwt.strategy';
import { COOKIE_EXPIRATION_TIME, CookieService } from './cookie/cookie.service';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    HttpModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>(SessionModule.JWT_SECRET_ENV),
        signOptions: {
          expiresIn: COOKIE_EXPIRATION_TIME,
        },
      }),
    }),
  ],
  controllers: [SessionController],
  providers: [CouchAuthStrategy, JwtStrategy, CookieService],
  exports: [CookieService],
})
export class SessionModule {
  static readonly JWT_SECRET_ENV = 'JWT_SECRET';
}
