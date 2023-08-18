import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { DocumentModule } from './document/document.module';
import { ReplicationModule } from './replication/replication.module';
import { SessionController } from './session/session.controller';
import { AuthModule } from '../auth/auth.module';
import { CombinedAuthGuard } from '../auth/guards/combined-auth/combined-auth.guard';
import { AttachmentModule } from './attachment/attachment.module';

@Module({
  imports: [ReplicationModule, AuthModule, DocumentModule, AttachmentModule],
  controllers: [SessionController],
})
export class RestrictedEndpointsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): any {
    consumer
      .apply(
        json({ limit: '10mb' }),
        urlencoded({ extended: true, limit: '10mb' }),
      )
      .forRoutes('*');
    consumer.apply(CombinedAuthGuard).exclude('_session');
    this.initializeProxy();
  }

  private initializeProxy() {}
}
