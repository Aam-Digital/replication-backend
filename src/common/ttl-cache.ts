/**
 * A small in-memory cache with per-entry time-to-live and a bounded size.
 *
 * Shared by the short-lived caches in front of CouchDB (basic-auth logins,
 * compiled CASL abilities, ...) so the TTL + eviction logic lives in one
 * place instead of being re-implemented per call site.
 *
 * Eviction is expiry-aware and LRU-ish: reads and writes move an entry to the
 * "most recently used" end, expired entries are dropped first, and only then
 * is the oldest live entry evicted — so exceeding the cap degrades the coldest
 * entries instead of wiping every warm one.
 */
export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAtMs: number }>();

  /**
   * @param ttlMs how long an entry stays valid after it is set
   * @param maxEntries hard cap on live entries (oldest evicted beyond it)
   */
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 1000,
  ) {}

  /** Returns the value if present and not expired, otherwise `undefined`. */
  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAtMs <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // refresh recency (Map keeps insertion order → re-insert moves to newest)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.store.delete(key);
    this.store.set(key, { value, expiresAtMs: Date.now() + this.ttlMs });
    this.evictIfNeeded();
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  private evictIfNeeded(): void {
    if (this.store.size <= this.maxEntries) {
      return;
    }
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAtMs <= now) {
        this.store.delete(key);
      }
    }
    // still over cap → drop oldest live entries (front of insertion order)
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.store.delete(oldest);
    }
  }
}
