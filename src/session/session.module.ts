import { Module } from '@nestjs/common';
import { SessionController } from './session/session.controller';
import { SessionService } from './session/session.service';
import { CouchAuthStrategy } from './auth/couch-auth.strategy';
import { HttpModule } from '@nestjs/axios';
import { PassportModule } from '@nestjs/passport';

@Module({
  imports: [HttpModule, PassportModule],
  controllers: [SessionController],
  providers: [SessionService, CouchAuthStrategy],
  exports: [SessionService],
})
export class SessionModule {}
