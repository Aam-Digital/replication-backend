import { Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  JsonArrayFilterOptions,
  JsonArrayFilterTransform,
  jsonTokenParser,
} from './json-array-filter';

/**
 * Pipe `input` (optionally pre-chunked) through parser + filter transform
 * and return the re-serialized output string.
 */
async function filterJson(
  input: string | string[],
  options: JsonArrayFilterOptions,
): Promise<string> {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  await pipeline(
    Readable.from(typeof input === 'string' ? [input] : input),
    jsonTokenParser(),
    new JsonArrayFilterTransform(options),
    sink,
  );
  return Buffer.concat(chunks).toString();
}

describe('JsonArrayFilterTransform', () => {
  const keepAll: JsonArrayFilterOptions = {
    arrayField: 'rows',
    mapItem: (item) => item,
  };

  it('passes through envelope fields before and after the array', async () => {
    const input = JSON.stringify({
      total_rows: 5,
      offset: 0,
      rows: [{ id: 'a' }, { id: 'b' }],
      bookmark: 'xyz',
    });

    const output = await filterJson(input, keepAll);

    expect(JSON.parse(output)).toEqual(JSON.parse(input));
  });

  it('drops items for which mapItem returns undefined', async () => {
    const input = JSON.stringify({
      rows: [{ id: 'keep-1' }, { id: 'drop' }, { id: 'keep-2' }],
    });

    const output = await filterJson(input, {
      arrayField: 'rows',
      mapItem: (item) => (item.id.startsWith('keep') ? item : undefined),
    });

    expect(JSON.parse(output)).toEqual({
      rows: [{ id: 'keep-1' }, { id: 'keep-2' }],
    });
  });

  it('emits transformed items', async () => {
    const input = JSON.stringify({ rows: [{ id: 'a', doc: { big: true } }] });

    const output = await filterJson(input, {
      arrayField: 'rows',
      mapItem: ({ doc: _doc, ...rest }) => rest,
    });

    expect(JSON.parse(output)).toEqual({ rows: [{ id: 'a' }] });
  });

  it('handles an empty target array', async () => {
    const output = await filterJson('{"total_rows":0,"rows":[]}', keepAll);
    expect(JSON.parse(output)).toEqual({ total_rows: 0, rows: [] });
  });

  it('outputs an empty array when all items are dropped', async () => {
    const output = await filterJson('{"rows":[{"id":"x"}],"after":1}', {
      arrayField: 'rows',
      mapItem: () => undefined,
    });
    expect(JSON.parse(output)).toEqual({ rows: [], after: 1 });
  });

  it('passes objects without the target array through unchanged', async () => {
    const input = JSON.stringify({
      error: 'not_found',
      nested: { rows: [1, 2] },
    });
    const output = await filterJson(input, keepAll);
    // note: only the *top-level* "rows" field is treated as the target array
    expect(JSON.parse(output)).toEqual(JSON.parse(input));
  });

  it('preserves complex nested items and value types', async () => {
    const input = JSON.stringify({
      ok: true,
      missing: null,
      count: 3.75,
      rows: [
        {
          id: 'a',
          doc: {
            tags: ['x', 'y'],
            num: 1e-5,
            deep: { arr: [{ inner: false }] },
          },
        },
        'scalar-item',
        42,
      ],
      seq: '12-abcdef',
    });

    const output = await filterJson(input, keepAll);

    expect(JSON.parse(output)).toEqual(JSON.parse(input));
  });

  it('preserves special characters and escaping', async () => {
    const input = JSON.stringify({
      'we"ird key': 'va\nlue "quoted"  ',
      rows: [{ text: 'ümläut ✓ \t "x"' }],
    });
    const output = await filterJson(input, keepAll);
    expect(JSON.parse(output)).toEqual(JSON.parse(input));
  });

  it('produces identical output when input arrives in tiny chunks', async () => {
    const input = JSON.stringify({
      total_rows: 2,
      rows: [{ id: 'a' }, { id: 'b' }],
      bookmark: 'b',
    });

    const whole = await filterJson(input, keepAll);
    const chunked = await filterJson(input.split(''), keepAll);

    expect(chunked).toEqual(whole);
  });

  it('rejects on truncated upstream JSON', async () => {
    await expect(filterJson('{"rows":[{"id":"a"}', keepAll)).rejects.toThrow();
  });

  it('rejects when the root is not an object', async () => {
    await expect(filterJson('[1,2,3]', keepAll)).rejects.toThrow(
      /Expected a JSON object/,
    );
  });

  it('rejects on malformed JSON', async () => {
    await expect(filterJson('{"rows": [}', keepAll)).rejects.toThrow();
  });
});
