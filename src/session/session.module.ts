import { Module } from '@nestjs/common';
import { SessionController } from './session/session.controller';
import { CouchAuthStrategy } from './auth/couch-auth.strategy';
import { HttpModule } from '@nestjs/axios';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt/jwt.strategy';

export const JWT_SECRET = 'someSecret';

@Module({
  imports: [
    HttpModule,
    PassportModule,
    JwtModule.register({
      secret: JWT_SECRET,
      signOptions: {
        expiresIn: '60s',
      },
    }),
  ],
  controllers: [SessionController],
  providers: [CouchAuthStrategy, JwtStrategy],
})
export class SessionModule {}
