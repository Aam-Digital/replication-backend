import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import compression from 'compression';
import { json, urlencoded } from 'express';
import { AuthModule } from '../auth/auth.module';
import { CombinedAuthGuard } from '../auth/guards/combined-auth/combined-auth.guard';
import { AttachmentModule } from './attachment/attachment.module';
import { DocumentModule } from './document/document.module';
import { ReplicationModule } from './replication/replication.module';
import { SessionController } from './session/session.controller';

@Module({
  imports: [ReplicationModule, AuthModule, DocumentModule, AttachmentModule],
  controllers: [SessionController],
})
export class RestrictedEndpointsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(
        // compress (large) JSON responses if the client supports it;
        // significant for replication payloads on slow links.
        // Skips responses that already have a Content-Encoding (e.g.
        // proxied CouchDB responses) and non-compressible content types.
        compression(),
        json({ limit: '10mb' }),
        urlencoded({ extended: true, limit: '10mb' }),
      )
      .forRoutes('*');
    consumer.apply(CombinedAuthGuard).exclude('_session');
    this.initializeProxy();
  }

  private initializeProxy() {}
}
