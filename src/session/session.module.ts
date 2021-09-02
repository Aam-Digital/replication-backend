import { Module } from '@nestjs/common';
import { SessionController } from './session/session.controller';

@Module({
  controllers: [SessionController],
})
export class SessionModule {}
