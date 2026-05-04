import { HttpException, HttpStatus } from '@nestjs/common';
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
    service.getChanges('app');
    service.getChanges('app');

    // Only one _changes request should be started
    expect(mockCouchdbService.get).toHaveBeenCalledTimes(1);
  });

  it('should start separate feeds for different databases', () => {
    const changesSubject = new Subject();
    jest
      .spyOn(mockCouchdbService, 'get')
      .mockReturnValue(changesSubject as any);

    service.getChanges('app');
    service.getChanges('other-db');

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

  it('should back off and not retry at 1Hz on persistent CouchDB auth errors', () => {
    jest.useFakeTimers();

    const getSpy = jest.spyOn(mockCouchdbService, 'get').mockReturnValue(
      throwError(
        () =>
          new HttpException(
            {
              error: 'unauthorized',
              reason: 'Name or password is incorrect.',
            },
            HttpStatus.UNAUTHORIZED,
          ),
      ) as any,
    );

    service.getChanges('app').subscribe({ error: () => undefined });

    // Initial attempt happens synchronously upon subscription.
    expect(getSpy).toHaveBeenCalledTimes(1);

    // Without backoff, retry({ delay: 1000 }) would have caused 30 retries in 30s.
    // With exponential backoff (2s, 4s, 8s, 16s, 32s, 60s cap) we expect well under that.
    jest.advanceTimersByTime(30_000);

    expect(getSpy.mock.calls.length).toBeGreaterThan(1);
    expect(getSpy.mock.calls.length).toBeLessThan(10);
    jest.useRealTimers();
  });

  it('logs feed errors as warnings during backoff and escalates to error once saturated', () => {
    jest.useFakeTimers();

    jest
      .spyOn(mockCouchdbService, 'get')
      .mockReturnValue(
        throwError(() => new HttpException('Bad Gateway', 502)) as any,
      );

    const warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
    const errorSpy = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);

    service.getChanges('app').subscribe({ error: () => undefined });

    // Backoff sequence with initial=1s, max=60s: 1s, 2s, 4s, 8s, 16s, 32s, 60s, 60s, ...
    // Cumulative wait to reach the first saturated retry (#7): 1+2+4+8+16+32 = 63s.
    jest.advanceTimersByTime(70_000);

    // Pre-saturation failures (#1..#6) should be warnings, not errors.
    expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(6);
    // The first saturated failure (#7) should be logged as an error.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('SUSTAINED OUTAGE'),
    );
    expect(errorSpy.mock.calls.length).toBe(1);

    jest.useRealTimers();
  });
});
