import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { json, urlencoded } from 'express';
import { DocumentModule } from './document/document.module';
import { ReplicationModule } from './replication/replication.module';
import { SessionController } from './session/session.controller';
import { AuthModule } from '../auth/auth.module';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { CombinedAuthGuard } from '../auth/guards/combined-auth/combined-auth.guard';

@Module({
  imports: [ReplicationModule, AuthModule, DocumentModule],
  controllers: [SessionController],
})
export class RestrictedEndpointsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): any {
    this.applyProxyForPermissionlessCouchdbEndpoints(consumer);

    consumer
      .apply(
        json({ limit: '10mb' }),
        urlencoded({ extended: true, limit: '10mb' }),
      )
      .forRoutes('*');
  }

  private applyProxyForPermissionlessCouchdbEndpoints(
    consumer: MiddlewareConsumer,
  ) {
    consumer
      .apply(
        CombinedAuthGuard,
        createProxyMiddleware({
          target: process.env.DATABASE_URL,
          secure: true,
          changeOrigin: true,
          followRedirects: false,
          xfwd: true,
          autoRewrite: true,
          onProxyReq: (proxyReq) => {
            // Removing existing cookie and overwriting header with authorized credentials
            const authHeader = Buffer.from(
              `${process.env.DATABASE_USER}:${process.env.DATABASE_PASSWORD}`,
            ).toString('base64');
            proxyReq.setHeader('authorization', `Basic ${authHeader}`);
            proxyReq.removeHeader('cookie');
          },
        }),
      )
      .exclude(
        { path: 'admin/reload/:db', method: RequestMethod.POST },
        { path: 'admin/clear_local/:db', method: RequestMethod.POST },
        { path: '_session', method: RequestMethod.ALL },
        { path: ':db/_bulk_docs', method: RequestMethod.POST },
        { path: ':db/_bulk_get', method: RequestMethod.POST },
        { path: ':db/_all_docs', method: RequestMethod.POST },
        { path: ':db/_all_docs', method: RequestMethod.GET },
        // First character of ID has to be letter or number
        // otherwise potential collision with internal endpoints (e.g. _changes, _revs_diff...)
        { path: ':db/:docId([A-Za-z0-9].*)', method: RequestMethod.GET },
        { path: ':db/:docId([A-Za-z0-9].*)', method: RequestMethod.PUT },
      )
      .forRoutes('*');
  }
}
