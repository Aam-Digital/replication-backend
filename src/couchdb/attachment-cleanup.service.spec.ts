import { Logger } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AttachmentCleanupService } from './attachment-cleanup.service';
import { AllDocsResponse } from '../restricted-endpoints/replication/bulk-document/couchdb-dtos/all-docs.dto';
import {
  BulkDocsRequest,
  BulkDocsResponse,
} from '../restricted-endpoints/replication/bulk-document/couchdb-dtos/bulk-docs.dto';

const EMPTY_ALL_DOCS: AllDocsResponse = { total_rows: 0, offset: 0, rows: [] };

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

function makeService(opts?: {
  /** response for the source-db liveness check (`db/_all_docs`); defaults to "nothing is live", i.e. every id is confirmed deleted */
  sourceAllDocsResponse?: AllDocsResponse;
  sourceAllDocsError?: Error;
  /** response for the attachments-db rev lookup (`<db>-attachments/_all_docs`) */
  attachmentsAllDocsResponse?: AllDocsResponse;
  attachmentsAllDocsError?: Error;
  bulkDeleteResponse?: BulkDocsResponse;
}) {
  const couchdb = {
    post: jest.fn((db: string, path: string) => {
      if (path === '_all_docs') {
        if (db.endsWith('-attachments')) {
          return opts?.attachmentsAllDocsError
            ? throwError(() => opts.attachmentsAllDocsError)
            : of(opts?.attachmentsAllDocsResponse ?? EMPTY_ALL_DOCS);
        }
        return opts?.sourceAllDocsError
          ? throwError(() => opts.sourceAllDocsError)
          : of(opts?.sourceAllDocsResponse ?? EMPTY_ALL_DOCS);
      }
      // _bulk_docs
      return of(opts?.bulkDeleteResponse ?? []);
    }),
  };
  const service = new AttachmentCleanupService(couchdb as any);
  return { service, couchdb };
}

describe('AttachmentCleanupService', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('cleanupForDeletedDocs', () => {
    it('does nothing when there are no doc ids', async () => {
      const { service, couchdb } = makeService();

      await service.cleanupForDeletedDocs('app', []);

      expect(couchdb.post).not.toHaveBeenCalled();
    });

    it('deletes the matching app-attachments document', async () => {
      const { service, couchdb } = makeService({
        attachmentsAllDocsResponse: allDocsResponseFor({
          id: 'Child:1',
          rev: '3-abc',
        }),
      });

      await service.cleanupForDeletedDocs('app', ['Child:1']);

      expect(couchdb.post).toHaveBeenCalledWith('app', '_all_docs', {
        keys: ['Child:1'],
      });
      expect(couchdb.post).toHaveBeenCalledWith(
        'app-attachments',
        '_all_docs',
        {
          keys: ['Child:1'],
        },
      );
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
        attachmentsAllDocsResponse: { total_rows: 1, offset: 0, rows: [] },
      });

      await service.cleanupForDeletedDocs('app', ['Child:1']);

      // the source-db liveness check + the attachments-db lookup, no bulk delete
      expect(couchdb.post).toHaveBeenCalledTimes(2);
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
      const { service, couchdb } = makeService({
        attachmentsAllDocsResponse: response,
      });

      await service.cleanupForDeletedDocs('app', ['Child:1', 'Child:2']);

      expect(couchdb.post).toHaveBeenCalledWith(
        'app-attachments',
        '_bulk_docs',
        {
          docs: [{ _id: 'Child:1', _rev: '3-abc', _deleted: true }],
        },
      );
    });

    it('swallows errors from the attachments lookup and never throws', async () => {
      const { service } = makeService({
        attachmentsAllDocsError: new Error('boom'),
      });

      await expect(
        service.cleanupForDeletedDocs('app', ['Child:1']),
      ).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('does not clean up a doc that is still live under a different revision', async () => {
      // e.g. an offline conflict: the delete tombstone lost, another edit won
      const { service, couchdb } = makeService({
        sourceAllDocsResponse: allDocsResponseFor({
          id: 'Child:1',
          rev: '4-still-live',
        }),
      });

      await service.cleanupForDeletedDocs('app', ['Child:1']);

      expect(couchdb.post).toHaveBeenCalledWith('app', '_all_docs', {
        keys: ['Child:1'],
      });
      expect(couchdb.post).not.toHaveBeenCalledWith(
        'app-attachments',
        '_all_docs',
        expect.anything(),
      );
    });

    it('cleans up only the docs confirmed gone, skipping the still-live ones', async () => {
      const { service, couchdb } = makeService({
        sourceAllDocsResponse: allDocsResponseFor({
          id: 'Child:1',
          rev: '4-still-live',
        }),
        attachmentsAllDocsResponse: allDocsResponseFor({
          id: 'Child:2',
          rev: '1-att',
        }),
      });

      await service.cleanupForDeletedDocs('app', ['Child:1', 'Child:2']);

      expect(couchdb.post).toHaveBeenCalledWith(
        'app-attachments',
        '_all_docs',
        {
          keys: ['Child:2'],
        },
      );
      expect(couchdb.post).toHaveBeenCalledWith(
        'app-attachments',
        '_bulk_docs',
        { docs: [{ _id: 'Child:2', _rev: '1-att', _deleted: true }] },
      );
    });

    it('swallows errors from the liveness check itself and never throws', async () => {
      const { service, couchdb } = makeService({
        sourceAllDocsError: new Error('network blip'),
      });

      await expect(
        service.cleanupForDeletedDocs('app', ['Child:1']),
      ).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
      expect(couchdb.post).not.toHaveBeenCalledWith(
        'app-attachments',
        '_all_docs',
        expect.anything(),
      );
    });

    it('logs a warning when deleting an attachment doc partially fails', async () => {
      const { service } = makeService({
        attachmentsAllDocsResponse: allDocsResponseFor(
          { id: 'Child:1', rev: '3-abc' },
          { id: 'Child:2', rev: '3-def' },
        ),
        bulkDeleteResponse: [
          { ok: true, id: 'Child:1', rev: '4-new' },
          {
            error: 'conflict',
            id: 'Child:2',
            reason: 'conflict',
            rev: '3-def',
          },
        ],
      });

      await service.cleanupForDeletedDocs('app', ['Child:1', 'Child:2']);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('1 attachment doc(s)'),
        expect.objectContaining({
          failures: [
            expect.objectContaining({ id: 'Child:2', error: 'conflict' }),
          ],
        }),
      );
    });
  });

  describe('cleanupForBulkWrite', () => {
    it('cleans up only the docs that were both deleted and successfully written (new_edits=false)', async () => {
      const { service, couchdb } = makeService({
        attachmentsAllDocsResponse: allDocsResponseFor({
          id: 'Child:1',
          rev: '3-abc',
        }),
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

      expect(couchdb.post).toHaveBeenCalledWith(
        'app-attachments',
        '_all_docs',
        {
          keys: ['Child:1'],
        },
      );
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

    it('does not misattribute an error to the wrong doc when the same _id appears twice (new_edits=false)', async () => {
      // Two conflicting leaf revisions of the same entity pushed in one
      // batch: the tombstone (rev 2-tomb) actually succeeded, but a
      // different revision (2-other) of the same _id failed. An id-only
      // match would wrongly treat the successful tombstone as failed.
      const { service, couchdb } = makeService({
        attachmentsAllDocsResponse: allDocsResponseFor({
          id: 'Child:1',
          rev: '1-att',
        }),
      });
      const written: BulkDocsRequest = {
        new_edits: false,
        docs: [
          { _id: 'Child:1', _rev: '2-tomb', _deleted: true },
          { _id: 'Child:1', _rev: '2-other' },
        ],
      };
      const response: BulkDocsResponse = [
        {
          error: 'conflict',
          id: 'Child:1',
          reason: 'conflict',
          rev: '2-other',
        },
      ];

      await service.cleanupForBulkWrite('app', written, response);

      expect(couchdb.post).toHaveBeenCalledWith(
        'app-attachments',
        '_all_docs',
        {
          keys: ['Child:1'],
        },
      );
    });

    it('pairs new_edits:true results by position, not by _id', async () => {
      // new_edits:true returns one result per submitted doc, in order, with
      // a server-assigned rev that never equals the submitted rev.
      const { service, couchdb } = makeService({
        attachmentsAllDocsResponse: allDocsResponseFor({
          id: 'Child:1',
          rev: '1-att',
        }),
      });
      const written: BulkDocsRequest = {
        new_edits: true,
        docs: [{ _id: 'Child:1', _rev: '1-a', _deleted: true }],
      };
      const response: BulkDocsResponse = [
        { ok: true, id: 'Child:1', rev: '2-server-assigned' },
      ];

      await service.cleanupForBulkWrite('app', written, response);

      expect(couchdb.post).toHaveBeenCalledWith(
        'app-attachments',
        '_all_docs',
        {
          keys: ['Child:1'],
        },
      );
    });

    it('does not clean up a new_edits:true delete that failed', async () => {
      const { service, couchdb } = makeService();
      const written: BulkDocsRequest = {
        new_edits: true,
        docs: [{ _id: 'Child:1', _rev: '1-a', _deleted: true }],
      };
      const response: BulkDocsResponse = [
        { error: 'conflict', id: 'Child:1', reason: 'conflict', rev: '1-a' },
      ];

      await service.cleanupForBulkWrite('app', written, response);

      expect(couchdb.post).not.toHaveBeenCalled();
    });
  });
});
