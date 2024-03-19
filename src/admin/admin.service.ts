import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { AllDocsResponse } from '../restricted-endpoints/replication/bulk-document/couchdb-dtos/all-docs.dto';
import { CouchdbService } from '../couchdb/couchdb.service';

@Injectable()
export class AdminService {
  constructor(private couchdbService: CouchdbService) {}

  async clearLocal(db: string) {
    const localDocsResponse = await firstValueFrom(
      this.couchdbService.get<AllDocsResponse>(db, '_local_docs'),
    );

    // Get IDs of the replication checkpoints
    const ids = localDocsResponse.rows
      .map((doc) => doc.id)
      .filter(
        (id) => !id.includes('purge-mrview') && !id.includes('shard-sync'),
      );
    const deletePromises = ids.map((id) =>
      firstValueFrom(this.couchdbService.delete(db, id)),
    );

    await Promise.all(deletePromises);
  }
}
