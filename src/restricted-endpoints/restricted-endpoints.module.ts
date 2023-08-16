import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
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
    consumer
      .apply(
        json({ limit: '10mb' }),
        urlencoded({ extended: true, limit: '10mb' }),
      )
      .forRoutes('*');
    consumer.apply(CombinedAuthGuard).exclude('_session');
    this.initializeProxy();
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
