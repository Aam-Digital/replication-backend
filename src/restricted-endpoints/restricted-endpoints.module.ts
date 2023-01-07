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
import { createProxyMiddleware, RequestHandler } from 'http-proxy-middleware';
import { CombinedAuthGuard } from '../auth/guards/combined-auth/combined-auth.guard';
import { AttachmentModule } from './attachment/attachment.module';

@Module({
  imports: [ReplicationModule, AuthModule, DocumentModule, AttachmentModule],
  controllers: [SessionController],
})
export class RestrictedEndpointsModule implements NestModule {
  /**
   * This proxy allows to send authenticated requests to the real database
   */
  static proxy: RequestHandler;

  configure(consumer: MiddlewareConsumer): any {
    this.applyProxyForPermissionlessCouchdbEndpoints(consumer);
    consumer
      .apply(
        json({ limit: '10mb' }),
        urlencoded({ extended: true, limit: '10mb' }),
      )
      .exclude({ path: ':db/:docId/:property', method: RequestMethod.PUT })
      .forRoutes('*');
  }

  private applyProxyForPermissionlessCouchdbEndpoints(
    consumer: MiddlewareConsumer,
  ) {
    this.initializeProxy();
    consumer
      .apply(CombinedAuthGuard, RestrictedEndpointsModule.proxy)
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
        {
          path: ':db/:docId([A-Za-z0-9].*)/:property',
          method: RequestMethod.GET,
        },
        {
          path: ':db/:docId([A-Za-z0-9].*)/:property',
          method: RequestMethod.PUT,
        },
      )
      .forRoutes('*');
  }

  private initializeProxy() {
    RestrictedEndpointsModule.proxy = createProxyMiddleware({
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
    });
  }
}
