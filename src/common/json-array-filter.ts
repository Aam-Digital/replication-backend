import { Transform, TransformCallback } from 'stream';
import { parser } from 'stream-json';
import Assembler from 'stream-json/Assembler';

/** token emitted by the stream-json parser (with packed keys/values) */
interface JsonToken {
  name: string;
  value?: string | boolean | null;
}

const VALUE_START_TOKENS = new Set([
  'startObject',
  'startArray',
  'stringValue',
  'numberValue',
  'trueValue',
  'falseValue',
  'nullValue',
]);

export interface JsonArrayFilterOptions {
  /** name of the top-level array field whose items are filtered/transformed */
  arrayField: string;
  /**
   * Called for each item of the target array.
   * Return the (possibly transformed) item to include it in the output,
   * or `undefined` to drop it.
   */
  mapItem: (item: any) => unknown | undefined;
}

/**
 * Creates a stream-json parser configured for {@link JsonArrayFilterTransform}
 * (packed keys/values only).
 */
export function jsonTokenParser(): Transform {
  return parser({
    packValues: true,
    packKeys: true,
    streamValues: false,
    streamKeys: false,
  }) as unknown as Transform;
}

/**
 * Re-serializes a JSON *object* incrementally from a stream-json token
 * stream, applying a filter/transform to each element of one top-level
 * array field while passing all other fields through unchanged — without
 * ever holding the whole document (or the whole array) in memory.
 *
 * Envelope fields may appear before and/or after the array (e.g. CouchDB
 * sends `total_rows` before `rows`, but `bookmark` after `docs`).
 *
 * Input: stream-json tokens (objectMode, from {@link jsonTokenParser}).
 * Output: JSON text chunks.
 *
 * If the token stream ends before the root object is closed (truncated
 * upstream response), the stream errors — propagated by `stream.pipeline`
 * so an incomplete upstream response never yields valid-looking output.
 */
export class JsonArrayFilterTransform extends Transform {
  private mode: 'init' | 'members' | 'value' | 'items' | 'done' = 'init';
  private pendingKey = '';
  private firstMember = true;
  private firstItem = true;
  private assembler?: Assembler;
  private valueDepth = 0;

  constructor(private readonly options: JsonArrayFilterOptions) {
    super({ writableObjectMode: true, readableObjectMode: false });
  }

  _transform(token: JsonToken, _enc: string, callback: TransformCallback) {
    try {
      this.processToken(token);
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  _flush(callback: TransformCallback) {
    if (this.mode !== 'done') {
      callback(
        new Error('Unexpected end of JSON stream (truncated upstream body)'),
      );
      return;
    }
    callback();
  }

  private processToken(token: JsonToken) {
    switch (this.mode) {
      case 'init':
        if (token.name !== 'startObject') {
          throw new Error(
            `Expected a JSON object as response root, got token "${token.name}"`,
          );
        }
        this.push('{');
        this.mode = 'members';
        return;

      case 'members':
        if (token.name === 'keyValue') {
          this.pendingKey = token.value as string;
          this.mode = 'value';
          this.assembler = undefined;
          return;
        }
        if (token.name === 'endObject') {
          this.push('}');
          this.mode = 'done';
          return;
        }
        throw new Error(`Unexpected token "${token.name}" in object`);

      case 'value':
        if (
          !this.assembler &&
          this.pendingKey === this.options.arrayField &&
          token.name === 'startArray'
        ) {
          // the target array: stream its items individually
          this.pushMemberPrefix();
          this.push(JSON.stringify(this.pendingKey) + ':[');
          this.mode = 'items';
          this.firstItem = true;
          return;
        }
        this.consumeValueToken(token, (value) => {
          this.pushMemberPrefix();
          this.push(JSON.stringify(this.pendingKey) + ':');
          this.push(JSON.stringify(value) ?? 'null');
          this.mode = 'members';
        });
        return;

      case 'items':
        if (!this.assembler && token.name === 'endArray') {
          this.push(']');
          this.mode = 'members';
          return;
        }
        this.consumeValueToken(token, (item) => {
          const mapped = this.options.mapItem(item);
          if (mapped !== undefined) {
            if (!this.firstItem) {
              this.push(',');
            }
            this.push(JSON.stringify(mapped));
            this.firstItem = false;
          }
          this.mode = 'items';
        });
        return;

      case 'done':
        throw new Error(`Unexpected token "${token.name}" after JSON root`);
    }
  }

  /**
   * Feed a token into the per-value assembler, invoking `onComplete`
   * with the assembled JS value once it is finished.
   */
  private consumeValueToken(
    token: JsonToken,
    onComplete: (value: unknown) => void,
  ) {
    if (!this.assembler) {
      if (!VALUE_START_TOKENS.has(token.name)) {
        throw new Error(`Unexpected token "${token.name}", expected a value`);
      }
      this.assembler = new Assembler();
      this.valueDepth = 0;
    }

    this.assembler.consume(token as { name: string; value?: string });
    if (token.name === 'startObject' || token.name === 'startArray') {
      this.valueDepth++;
    } else if (token.name === 'endObject' || token.name === 'endArray') {
      this.valueDepth--;
    }

    if (this.valueDepth === 0) {
      const value = this.assembler.current;
      this.assembler = undefined;
      onComplete(value);
    }
  }

  private pushMemberPrefix() {
    if (!this.firstMember) {
      this.push(',');
    }
    this.firstMember = false;
  }
}
