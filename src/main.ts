import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { SentryService } from '@ntegral/nestjs-sentry';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Proxy for CouchDB admin view, CouchDB can be directly accessed through this path
  app.use(
    '/couchdb',
    createProxyMiddleware({
      pathRewrite: { '/couchdb/': '/' },
      target: process.env.DATABASE_URL,
      secure: true,
      changeOrigin: true,
      followRedirects: false,
      xfwd: true,
      autoRewrite: true,
    }),
  );

  // SwaggerUI setup see https://docs.nestjs.com/openapi/introduction#bootstrap
  const config = new DocumentBuilder()
    .setTitle(process.env.npm_package_name)
    .setDescription(process.env.npm_package_description)
    .setVersion(process.env.npm_package_version)
    .addServer('/', 'local')
    .addServer('/db', 'deployed') // used when this runs as part of the [ndb-setup](https://github.com/Aam-Digital/ndb-setup) docker-compose
    .addBasicAuth(undefined, 'BasicAuth')
    .addSecurityRequirements('BasicAuth')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  // Required for JWT cookie auth
  app.use(cookieParser());

  // Logging everything through sentry
  app.useLogger(SentryService.SentryServiceInstance());

  await app.listen(3000);
}
bootstrap();
