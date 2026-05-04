import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { AppModule } from './app.module';
import { SentryLogger } from './common/sentry-logger.service';
import { AppConfiguration } from './config/configuration';
import { configureSentry, initSentry } from './sentry.configuration';

async function bootstrap() {
  // Load .env into process.env before reading configuration, so that early
  // bootstrap code (AppConfiguration / initSentry) sees the same values
  // that Nest's ConfigModule will load later on. In docker-compose this is
  // a no-op because env vars are already set; locally it picks up `.env`.
  dotenv.config();

  // Load configuration and initialize Sentry as early as possible so that
  // logs emitted during Nest bootstrap can already be forwarded.
  const configService = new ConfigService(AppConfiguration());
  const sentryEnabled = initSentry(configService);

  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: sentryEnabled ? new SentryLogger() : undefined,
  });
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

  app.getHttpAdapter().getInstance().disable('x-powered-by');

  // SwaggerUI setup see https://docs.nestjs.com/openapi/introduction#bootstrap
  const config = new DocumentBuilder()
    .setTitle(process.env.npm_package_name ?? '')
    .setDescription(process.env.npm_package_description ?? '')
    .setVersion(process.env.npm_package_version ?? '')
    .addServer('/', 'local')
    .addServer('/db', 'deployed') // used when this runs as part of the [ndb-setup](https://github.com/Aam-Digital/ndb-setup) docker-compose
    .addBasicAuth(undefined, 'BasicAuth')
    .addSecurityRequirements('BasicAuth')
    .addBearerAuth(undefined, 'BearerAuth')
    .addSecurityRequirements('BearerAuth')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  // Required for JWT cookie auth
  app.use(cookieParser());

  configureSentry(app);

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
