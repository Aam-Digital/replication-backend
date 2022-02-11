import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { createProxyMiddleware } from 'http-proxy-middleware';

@Module({})
export class ProxyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): any {
    consumer
      .apply(
        createProxyMiddleware({
          target: process.env.DATABASE_URL,
          secure: true,
          changeOrigin: true,
          followRedirects: false,
          xfwd: true,
          autoRewrite: true,
          auth: `${process.env.DATABASE_USER}:${process.env.DATABASE_PASSWORD}`,
          onProxyReq: (proxyReq) => proxyReq.removeHeader('cookie'),
        }),
      )
      .exclude(
        { path: '_session', method: RequestMethod.ALL },
        { path: ':db/_bulk_docs', method: RequestMethod.POST },
        { path: ':db/_bulk_get', method: RequestMethod.POST },
        { path: ':db/_all_docs', method: RequestMethod.POST },
        { path: ':db/_all_docs', method: RequestMethod.GET },
        { path: ':db/clear_local', method: RequestMethod.POST },
        // First character of ID has to be letter or number, otherwise potential collision with `_changes` request
        { path: ':db/:docId([A-Za-b0-9]*)', method: RequestMethod.GET },
        { path: ':db/:docId([A-Za-b0-9]*)', method: RequestMethod.PUT },
        { path: 'rules/:db/reload', method: RequestMethod.POST },
      )
      .forRoutes('*');
  }
}
