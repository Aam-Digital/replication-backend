import { Module } from '@nestjs/common';
import { CouchProxyController } from './couch-proxy/couch-proxy.controller';
import { HttpModule } from '@nestjs/axios';
import { DocumentFilterService } from './document-filter/document-filter.service';
import { SessionModule } from './session/session.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    HttpModule,
    SessionModule,
    ConfigModule.forRoot({ isGlobal: true }),
  ],
  controllers: [CouchProxyController],
  providers: [DocumentFilterService],
})
export class AppModule {}

// TODO move to env
export const COUCH_ENDPOINT = 'https://dev.aam-digital.com/db';
