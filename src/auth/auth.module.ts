import { Module } from '@nestjs/common';
import { CouchAuthStrategy } from './guards/session-auth/couch-auth.strategy';
import { HttpModule } from '@nestjs/axios';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './guards/jwt/jwt.strategy';
import { COOKIE_EXPIRATION_TIME, CookieService } from './cookie/cookie.service';
import { ConfigService } from '@nestjs/config';
import { BasicAuthStrategy } from './guards/basic-auth/basic-auth.strategy';

@Module({
  imports: [
    HttpModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>(AuthModule.JWT_SECRET_ENV),
        signOptions: {
          expiresIn: COOKIE_EXPIRATION_TIME,
        },
      }),
    }),
  ],
  providers: [CouchAuthStrategy, JwtStrategy, CookieService, BasicAuthStrategy],
  exports: [CookieService],
})
export class AuthModule {
  static readonly JWT_SECRET_ENV = 'JWT_SECRET';
}
