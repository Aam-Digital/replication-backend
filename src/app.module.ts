import { Module } from '@nestjs/common';
import { CouchProxyController } from './couch-proxy/couch-proxy.controller';
import { HttpModule } from '@nestjs/axios';
import { DocumentFilterService } from './document-filter/document-filter.service';
import { SessionModule } from './session/session.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    HttpModule,
    ConfigModule.forRoot({ isGlobal: true }),
    SessionModule,
  ],
  controllers: [CouchProxyController],
  providers: [DocumentFilterService],
})
export class AppModule {}
