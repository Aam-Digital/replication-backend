import { Global, Module } from '@nestjs/common';
import { CouchdbService } from './couchdb.service';
import { HttpModule } from '@nestjs/axios';

@Global()
@Module({
  imports: [HttpModule],
  providers: [CouchdbService],
  exports: [CouchdbService],
})
export class CouchdbModule {}
