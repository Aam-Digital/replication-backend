import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('couchdb/db');

  // Required for JWT cookie auth
  app.use(cookieParser());

  // SwaggerUI setup see https://docs.nestjs.com/openapi/introduction#bootstrap
  const config = new DocumentBuilder()
    .setTitle('Replication Backend')
    .setDescription('A proxy that implements the CouchDB replication protocol')
    .setVersion('Beta')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(3000);
}
bootstrap();
