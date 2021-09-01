import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CouchProxyController } from './couch-proxy/couch-proxy.controller';
import { HttpModule } from '@nestjs/axios';
import { DocumentFilterService } from './document-filter/document-filter.service';

@Module({
  imports: [HttpModule],
  controllers: [AppController, CouchProxyController],
  providers: [AppService, DocumentFilterService],
})
export class AppModule {}
