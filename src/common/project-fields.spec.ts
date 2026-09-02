import { projectFields } from './project-fields';

describe('projectFields', () => {
  it('keeps only the listed top-level fields', () => {
    const doc = { _id: 'a', _rev: '1-x', title: 'T', body: 'B', size: 5 };
    expect(projectFields(doc, ['_id', 'title'])).toEqual({
      _id: 'a',
      title: 'T',
    });
  });

  it('resolves dotted paths into nested objects', () => {
    const doc = { _id: 'a', meta: { author: 'ada', private: true } };
    expect(projectFields(doc, ['_id', 'meta.author'])).toEqual({
      _id: 'a',
      meta: { author: 'ada' },
    });
  });

  it('omits fields that are absent from the source', () => {
    const doc = { _id: 'a', title: 'T' };
    expect(projectFields(doc, ['_id', 'missing', 'also.missing'])).toEqual({
      _id: 'a',
    });
  });

  it('keeps falsy values that are actually present', () => {
    const doc = { _id: 'a', count: 0, active: false, note: '' };
    expect(projectFields(doc, ['count', 'active', 'note'])).toEqual({
      count: 0,
      active: false,
      note: '',
    });
  });

  it('does not pollute the prototype through crafted field names', () => {
    // a doc coming off the wire can carry an own "__proto__" property
    const doc = JSON.parse('{"__proto__":{"polluted":true},"_id":"a"}');
    expect(projectFields(doc, ['__proto__.polluted', '_id'])).toEqual({
      _id: 'a',
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('returns an empty object when nothing matches', () => {
    expect(projectFields({ _id: 'a' }, ['x', 'y'])).toEqual({});
  });
});
