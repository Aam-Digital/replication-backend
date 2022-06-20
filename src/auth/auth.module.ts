import { Module } from '@nestjs/common';
import { BodyAuthStrategy } from './guards/body-auth/body-auth.strategy';
import { HttpModule } from '@nestjs/axios';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './guards/jwt/jwt.strategy';
import { COOKIE_EXPIRATION_TIME, CookieService } from './cookie/cookie.service';
import { ConfigService } from '@nestjs/config';
import { BasicAuthStrategy } from './guards/basic-auth/basic-auth.strategy';
import { CombinedAuthMiddleware } from './guards/combined-auth.middleware';

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
  providers: [
    BodyAuthStrategy,
    JwtStrategy,
    CookieService,
    BasicAuthStrategy,
    CombinedAuthMiddleware,
  ],
  exports: [CookieService, CombinedAuthMiddleware],
})
export class AuthModule {
  /** name of the environment variable that defines the JWT secret */
  static readonly JWT_SECRET_ENV = 'JWT_SECRET';
}
