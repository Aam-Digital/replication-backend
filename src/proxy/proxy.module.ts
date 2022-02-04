import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { JwtMiddleware } from '../auth/guards/jwt/jwt.middleware';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
})
export class ProxyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): any {
    consumer
      .apply(
        JwtMiddleware,
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
        { path: '_session', method: RequestMethod.POST },
        { path: ':db/_bulk_docs', method: RequestMethod.POST },
        { path: ':db/_bulk_get', method: RequestMethod.POST },
        { path: ':db/_all_docs', method: RequestMethod.POST },
        { path: ':db/_all_docs', method: RequestMethod.GET },
        { path: ':db/:docId', method: RequestMethod.GET },
        { path: ':db/:docId', method: RequestMethod.PUT },
        { path: 'clear_local', method: RequestMethod.POST },
        { path: 'rules/reload', method: RequestMethod.POST },
      )
      .forRoutes('*');
  }
}
