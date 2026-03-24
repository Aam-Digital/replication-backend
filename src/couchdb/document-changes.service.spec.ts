import { Test, TestingModule } from '@nestjs/testing';
import { NEVER, Subject, throwError } from 'rxjs';
import { CouchdbService } from './couchdb.service';
import { DocumentChangesService } from './document-changes.service';

describe('DocumentChangesService', () => {
  let service: DocumentChangesService;
  let mockCouchdbService: CouchdbService;

  beforeEach(async () => {
    mockCouchdbService = {
      get: jest.fn().mockReturnValue(NEVER),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentChangesService,
        { provide: CouchdbService, useValue: mockCouchdbService },
      ],
    }).compile();

    service = module.get(DocumentChangesService);
  });

  it('should start feed at current sequence using since=now', () => {
    const changesSubject = new Subject();
    jest
      .spyOn(mockCouchdbService, 'get')
      .mockReturnValue(changesSubject as any);

    service.getChanges('app');

    expect(mockCouchdbService.get).toHaveBeenCalledWith(
      'app',
      '_changes',
      expect.objectContaining({ since: 'now', include_docs: true }),
    );
  });

  it('should emit individual change results from the feed', () => {
    const changesSubject = new Subject();
    jest
      .spyOn(mockCouchdbService, 'get')
      .mockReturnValue(changesSubject as any);

    const emitted: any[] = [];
    service.getChanges('app').subscribe((change) => emitted.push(change));

    changesSubject.next({
      last_seq: '1',
      results: [
        { id: 'Child:1', seq: '1', changes: [{ rev: '1-abc' }] },
        { id: 'User:john', seq: '2', changes: [{ rev: '1-def' }] },
      ],
      pending: 0,
    });

    expect(emitted).toEqual([
      { id: 'Child:1', seq: '1', changes: [{ rev: '1-abc' }] },
      { id: 'User:john', seq: '2', changes: [{ rev: '1-def' }] },
    ]);
  });

  it('should reuse the same feed for the same database', () => {
    const subject1 = service.getChanges('app');
    const subject2 = service.getChanges('app');

    expect(subject1).toBe(subject2);
    // Only one _changes request should be started
    expect(mockCouchdbService.get).toHaveBeenCalledTimes(1);
  });

  it('should start separate feeds for different databases', () => {
    const changesSubject = new Subject();
    jest
      .spyOn(mockCouchdbService, 'get')
      .mockReturnValue(changesSubject as any);

    const subject1 = service.getChanges('app');
    const subject2 = service.getChanges('other-db');

    expect(subject1).not.toBe(subject2);
    expect(mockCouchdbService.get).toHaveBeenCalledTimes(2);
  });

  it('should multicast changes to multiple subscribers', () => {
    const changesSubject = new Subject();
    jest
      .spyOn(mockCouchdbService, 'get')
      .mockReturnValue(changesSubject as any);

    const emitted1: any[] = [];
    const emitted2: any[] = [];

    service.getChanges('app').subscribe((c) => emitted1.push(c));
    service.getChanges('app').subscribe((c) => emitted2.push(c));

    changesSubject.next({
      last_seq: '1',
      results: [{ id: 'Note:1', seq: '1', changes: [{ rev: '1-a' }] }],
      pending: 0,
    });

    expect(emitted1).toHaveLength(1);
    expect(emitted2).toHaveLength(1);
    expect(emitted1[0].id).toBe('Note:1');
  });

  it('should retry and continue after feed errors', () => {
    jest.useFakeTimers();

    const changesSubject = new Subject();
    let callCount = 0;

    jest.spyOn(mockCouchdbService, 'get').mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return throwError(
          () => new Error('temporary changes feed error'),
        ) as any;
      }
      return changesSubject as any;
    });

    const emitted: any[] = [];
    service.getChanges('app').subscribe((change) => emitted.push(change));

    // retry({ delay: 1000 }) should trigger a second request
    jest.advanceTimersByTime(1000);

    changesSubject.next({
      last_seq: '2',
      results: [{ id: 'User:alice', seq: '2', changes: [{ rev: '2-a' }] }],
      pending: 0,
    });

    expect(mockCouchdbService.get).toHaveBeenCalledTimes(2);
    expect(emitted).toEqual([
      { id: 'User:alice', seq: '2', changes: [{ rev: '2-a' }] },
    ]);

    jest.useRealTimers();
  });
});
