import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CouchProxyController } from './couch-proxy/couch-proxy.controller';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  controllers: [AppController, CouchProxyController],
  providers: [AppService],
})
export class AppModule {}
