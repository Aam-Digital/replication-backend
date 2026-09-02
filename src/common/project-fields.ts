import { get, has, set } from 'lodash';

/**
 * Path segments that must never be written into the projected object, so a
 * client-supplied field name cannot reach `Object.prototype` via `set`.
 */
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Reduce a document to only the requested field paths, mirroring the
 * `fields` option of CouchDB's `_find`:
 * - a dot-separated path (`"a.b"`) selects a nested value,
 * - paths that are absent from the source are simply left out,
 * - nothing is added implicitly (not even `_id`).
 *
 * See {@link https://docs.couchdb.org/en/stable/api/database/find.html#filtering-fields}
 */
export function projectFields<T extends Record<string, unknown>>(
  doc: T,
  fields: string[],
): Partial<T> {
  const projected: Record<string, unknown> = {};
  for (const field of fields) {
    const segments = field.split('.');
    if (segments.some((segment) => UNSAFE_SEGMENTS.has(segment))) {
      continue;
    }
    if (has(doc, segments)) {
      set(projected, segments, get(doc, segments));
    }
  }
  return projected as Partial<T>;
}
