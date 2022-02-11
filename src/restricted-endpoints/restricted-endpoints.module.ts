import { MiddlewareConsumer, Module } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { DocumentModule } from './document/document.module';
import { ReplicationModule } from './replication/replication.module';
import { SessionController } from './session/session.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ReplicationModule, AuthModule, DocumentModule],
  controllers: [SessionController],
})
export class RestrictedEndpointsModule {
  configure(consumer: MiddlewareConsumer): any {
    consumer
      .apply(
        json({ limit: '10mb' }),
        urlencoded({ extended: true, limit: '10mb' }),
      )
      .forRoutes('*');
  }
}
