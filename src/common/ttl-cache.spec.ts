import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  afterEach(() => jest.useRealTimers());

  it('returns a stored value before it expires', () => {
    const cache = new TtlCache<number>(1000);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
  });

  it('returns undefined for a missing key', () => {
    const cache = new TtlCache<number>(1000);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('expires and drops an entry after the TTL', () => {
    jest.useFakeTimers();
    const cache = new TtlCache<number>(1000);
    cache.set('a', 1);
    jest.advanceTimersByTime(1001);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0); // expired entry removed on read
  });

  it('evicts the oldest entry when the cap is exceeded instead of wiping all', () => {
    const cache = new TtlCache<number>(1000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // exceeds cap of 2 → 'a' (oldest) evicted
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('treats a read as recent use so the cap evicts the truly coldest', () => {
    const cache = new TtlCache<number>(1000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // 'a' becomes most-recently-used
    cache.set('c', 3); // 'b' is now coldest → evicted
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('drops expired entries first when over cap before evicting live ones', () => {
    jest.useFakeTimers();
    const cache = new TtlCache<number>(1000, 2);
    cache.set('a', 1);
    jest.advanceTimersByTime(1001); // 'a' now expired
    cache.set('b', 2);
    cache.set('c', 3); // over cap → expired 'a' reclaimed, 'b'/'c' survive
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('clear() removes everything', () => {
    const cache = new TtlCache<number>(1000);
    cache.set('a', 1);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
