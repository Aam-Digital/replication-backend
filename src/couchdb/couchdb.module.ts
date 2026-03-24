import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { CouchdbService } from './couchdb.service';
import { DocumentChangesService } from './document-changes.service';

@Global()
@Module({
  imports: [HttpModule],
  providers: [CouchdbService, DocumentChangesService],
  exports: [CouchdbService, DocumentChangesService],
})
export class CouchdbModule {}
