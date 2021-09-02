import { Module } from '@nestjs/common';
import { CouchProxyController } from './couch-proxy/couch-proxy.controller';
import { HttpModule } from '@nestjs/axios';
import { DocumentFilterService } from './document-filter/document-filter.service';

@Module({
  imports: [HttpModule],
  controllers: [CouchProxyController],
  providers: [DocumentFilterService],
})
export class AppModule {}
