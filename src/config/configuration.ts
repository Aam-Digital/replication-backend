import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { join } from 'path';

const CONFIG_FILENAME = 'app.yaml';

/**
 * Loads local CONFIG_FILENAME file and merges values from `process.env`
 * on top, so that environment variables (e.g. from docker-compose / .env)
 * always take precedence over YAML defaults.
 *
 * Result is provided to the NestJS ConfigService.
 * See: /src/config/app.yaml
 */
export function AppConfiguration(): Record<string, string> {
  const fromYaml = flatten(
    yaml.load(readFileSync(join(__dirname, CONFIG_FILENAME), 'utf8')) as Record<
      string,
      string
    >,
  );

  const fromEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      fromEnv[key] = value;
    }
  }

  // Env wins over YAML defaults.
  return { ...fromYaml, ...fromEnv };
}

/**
 * Recursively create a flat key-value object where keys contain nested keys as prefixes
 */
function flatten(
  obj: Record<string, unknown>,
  prefix = '',
  delimiter = '_',
): Record<string, string> {
  return Object.keys(obj).reduce<Record<string, string>>((acc, k) => {
    const pre = prefix.length ? prefix + delimiter : '';
    const value = obj[k];

    if (value !== null && !Array.isArray(value) && typeof value === 'object') {
      Object.assign(acc, flatten(value as Record<string, unknown>, pre + k));
    } else if (value != null) {
      acc[pre + k] = String(value);
    }
    return acc;
  }, {});
}
