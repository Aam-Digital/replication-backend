import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { join } from 'path';

const CONFIG_FILENAME = 'app.yaml';

/**
 * loads local CONFIG_FILENAME file and provides them in NestJs Config Service
 * See: /src/config/app.yaml
 */
export function AppConfiguration(): Record<string, string> {
  return flatten(
    yaml.load(readFileSync(join(__dirname, CONFIG_FILENAME), 'utf8')) as Record<
      string,
      string
    >,
  );
}

/**
 * Recursively create a flat key-value object where keys contain nested keys as prefixes
 */
function flatten(
  obj: any,
  prefix = '',
  delimiter = '_',
): Record<string, string> {
  return Object.keys(obj).reduce((acc: any, k: string) => {
    const pre = prefix.length ? prefix + delimiter : '';

    if (typeof obj[k] === 'object')
      Object.assign(acc, flatten(obj[k], pre + k));
    else {
      acc[pre + k] = obj[k];
    }
    return acc;
  }, {});
}
