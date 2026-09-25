import { of, throwError } from 'rxjs';
import { AttachmentCleanupService } from './attachment-cleanup.service';
import { AllDocsResponse } from '../restricted-endpoints/replication/bulk-document/couchdb-dtos/all-docs.dto';
import {
  BulkDocsRequest,
  BulkDocsResponse,
} from '../restricted-endpoints/replication/bulk-document/couchdb-dtos/bulk-docs.dto';

function makeService(opts?: {
  allDocsResponse?: AllDocsResponse;
  allDocsError?: Error;
}) {
  const couchdb = {
    post: jest.fn((db: string, path: string) => {
      if (path === '_all_docs') {
        return opts?.allDocsError
          ? throwError(() => opts.allDocsError)
          : of(opts?.allDocsResponse ?? { total_rows: 0, offset: 0, rows: [] });
      }
      // _bulk_docs
      return of([]);
    }),
  };
  const service = new AttachmentCleanupService(couchdb as any);
  return { service, couchdb };
}

function allDocsResponseFor(
  ...entries: { id: string; rev: string }[]
): AllDocsResponse {
  return {
    total_rows: entries.length,
    offset: 0,
    rows: entries.map((e) => ({
      id: e.id,
      key: e.id,
      value: { rev: e.rev },
    })),
  };
}

describe('AttachmentCleanupService', () => {
  describe('cleanupForDeletedDocs', () => {
    it('does nothing when there are no doc ids', async () => {
      const { service, couchdb } = makeService();

      await service.cleanupForDeletedDocs('app', []);

      expect(couchdb.post).not.toHaveBeenCalled();
    });

    it('deletes the matching app-attachments document', async () => {
      const { service, couchdb } = makeService({
        allDocsResponse: allDocsResponseFor({ id: 'Child:1', rev: '3-abc' }),
      });

      await service.cleanupForDeletedDocs('app', ['Child:1']);

      expect(couchdb.post).toHaveBeenCalledWith('app-attachments', '_all_docs', {
        keys: ['Child:1'],
      });
      expect(couchdb.post).toHaveBeenCalledWith(
        'app-attachments',
        '_bulk_docs',
        {
          docs: [{ _id: 'Child:1', _rev: '3-abc', _deleted: true }],
        },
      );
    });

    it('does not attempt a bulk delete when no docs have attachments', async () => {
      const { service, couchdb } = makeService({
        allDocsResponse: { total_rows: 1, offset: 0, rows: [] },
      });

      await service.cleanupForDeletedDocs('app', ['Child:1']);

      expect(couchdb.post).toHaveBeenCalledTimes(1); // only the _all_docs lookup
      expect(couchdb.post).not.toHaveBeenCalledWith(
        expect.anything(),
        '_bulk_docs',
        expect.anything(),
      );
    });

    it('ignores CouchDB error rows (e.g. not_found) mixed into the response', async () => {
      const response: AllDocsResponse = {
        total_rows: 2,
        offset: 0,
        rows: [
          { id: 'Child:1', key: 'Child:1', value: { rev: '3-abc' } },
          { key: 'Child:2', error: 'not_found' } as any,
        ],
      };
      const { service, couchdb } = makeService({ allDocsResponse: response });

      await service.cleanupForDeletedDocs('app', ['Child:1', 'Child:2']);

      expect(couchdb.post).toHaveBeenCalledWith(
        'app-attachments',
        '_bulk_docs',
        {
          docs: [{ _id: 'Child:1', _rev: '3-abc', _deleted: true }],
        },
      );
    });

    it('swallows errors and never throws, since it must not block the record delete', async () => {
      const { service } = makeService({ allDocsError: new Error('boom') });

      await expect(
        service.cleanupForDeletedDocs('app', ['Child:1']),
      ).resolves.toBeUndefined();
    });
  });

  describe('cleanupForBulkWrite', () => {
    it('cleans up only the docs that were both deleted and successfully written (new_edits=false)', async () => {
      const { service, couchdb } = makeService({
        allDocsResponse: allDocsResponseFor({ id: 'Child:1', rev: '3-abc' }),
      });
      const written: BulkDocsRequest = {
        new_edits: false,
        docs: [
          { _id: 'Child:1', _rev: '2-a', _deleted: true },
          { _id: 'Child:2', _rev: '2-b', _deleted: true }, // failed write, excluded below
          { _id: 'School:1', _rev: '2-c' }, // not deleted
        ],
      };
      const response: BulkDocsResponse = [
        { error: 'conflict', id: 'Child:2', reason: 'conflict', rev: '2-b' },
      ];

      await service.cleanupForBulkWrite('app', written, response);

      expect(couchdb.post).toHaveBeenCalledWith('app-attachments', '_all_docs', {
        keys: ['Child:1'],
      });
    });

    it('does nothing when nothing was deleted', async () => {
      const { service, couchdb } = makeService();
      const written: BulkDocsRequest = {
        new_edits: false,
        docs: [{ _id: 'School:1', _rev: '2-c' }],
      };

      await service.cleanupForBulkWrite('app', written, []);

      expect(couchdb.post).not.toHaveBeenCalled();
    });
  });
});
