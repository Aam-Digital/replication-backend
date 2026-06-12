import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { CouchdbService } from '../couchdb/couchdb.service';
import { map, of, throwError, timer } from 'rxjs';

describe('AdminService', () => {
  let service: AdminService;
  let mockCouchDBService: CouchdbService;

  beforeEach(async () => {
    mockCouchDBService = {
      get: () => of({ rows: [] }),
      delete: () => of({}),
    } as any;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: CouchdbService, useValue: mockCouchDBService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should delete all docs in the _local db', async () => {
    const mockAllDocsResponse = {
      rows: [
        { id: '_local/firstDoc' },
        { id: '_local/secondDoc' },
        { id: '_local/thirdDoc' },
      ],
    };
    jest
      .spyOn(mockCouchDBService, 'get')
      .mockReturnValue(of(mockAllDocsResponse));
    jest
      .spyOn(mockCouchDBService, 'delete')
      .mockReturnValue(of(undefined as any));
    const dbName = 'app';

    await service.clearLocal(dbName);

    expect(mockCouchDBService.get).toHaveBeenCalledWith(dbName, '_local_docs', {
      limit: AdminService.CLEAR_LOCAL_BATCH_SIZE,
    });
    mockAllDocsResponse.rows.forEach((row) => {
      expect(mockCouchDBService.delete).toHaveBeenCalledWith(dbName, row.id);
    });
  });

  it('should skip couchdb-internal local docs', async () => {
    jest.spyOn(mockCouchDBService, 'get').mockReturnValue(
      of({
        rows: [
          { id: '_local/checkpoint' },
          { id: '_local/purge-mrview-abc' },
          { id: '_local/shard-sync-def' },
        ],
      }),
    );
    const deleteSpy = jest
      .spyOn(mockCouchDBService, 'delete')
      .mockReturnValue(of(undefined as any));

    await service.clearLocal('app');

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith('app', '_local/checkpoint');
  });

  it('should delete with bounded concurrency', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `_local/doc-${i}`,
    }));
    jest.spyOn(mockCouchDBService, 'get').mockReturnValue(of({ rows }));

    let inFlight = 0;
    let maxInFlight = 0;
    jest.spyOn(mockCouchDBService, 'delete').mockImplementation(() => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return timer(2).pipe(
        map(() => {
          inFlight--;
          return {} as any;
        }),
      );
    });

    await service.clearLocal('app');

    expect(mockCouchDBService.delete).toHaveBeenCalledTimes(25);
    expect(maxInFlight).toBeLessThanOrEqual(
      AdminService.CLEAR_LOCAL_CONCURRENCY,
    );
  });

  it('should attempt all deletions despite failures and report them at the end', async () => {
    jest.spyOn(mockCouchDBService, 'get').mockReturnValue(
      of({
        rows: [
          { id: '_local/ok-1' },
          { id: '_local/broken' },
          { id: '_local/ok-2' },
        ],
      }),
    );
    const deleteSpy = jest
      .spyOn(mockCouchDBService, 'delete')
      .mockImplementation((db, id) =>
        id === '_local/broken'
          ? throwError(() => new Error('boom'))
          : of(undefined as any),
      );

    await expect(service.clearLocal('app')).rejects.toThrow(
      'failed to delete 1 local document(s)',
    );
    // all docs were still attempted
    expect(deleteSpy).toHaveBeenCalledWith('app', '_local/ok-1');
    expect(deleteSpy).toHaveBeenCalledWith('app', '_local/ok-2');
    // the failed doc is not retried endlessly
    expect(
      deleteSpy.mock.calls.filter(([, id]) => id === '_local/broken'),
    ).toHaveLength(1);
  });
});
