import { Module } from '@nestjs/common';
import { SessionController } from './session/session.controller';
import { SessionService } from './session/session.service';

@Module({
  controllers: [SessionController],
  providers: [SessionService],
})
export class SessionModule {}
