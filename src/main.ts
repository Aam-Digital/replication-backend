import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Required for JWT cookie auth
  app.use(cookieParser());
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  // SwaggerUI setup see https://docs.nestjs.com/openapi/introduction#bootstrap
  const config = new DocumentBuilder()
    .setTitle('Replication Backend')
    .setDescription('A proxy that implements the CouchDB replication protocol')
    .setVersion('Beta')
    .addServer('/', 'local')
    .addServer('/db', 'deployed')
    .addBasicAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // Proxy for CouchDB admin view
  app.use(
    '/db/',
    createProxyMiddleware({
      pathRewrite: { '/db/': '/' },
      target: process.env.DATABASE_URL,
      secure: true,
      changeOrigin: true,
      followRedirects: false,
      xfwd: true,
      autoRewrite: true,
    }),
  );

  await app.listen(3000);
}
bootstrap();
