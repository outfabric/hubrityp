import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { clientEnvSchema, serverEnvSchema } from '@/shared/env/schemas';

const ROOT = path.resolve(__dirname, '../../..');

async function loadDotenvKeys(file: string): Promise<string[]> {
  const source = await readFile(path.resolve(ROOT, file), 'utf8');
  const keys: string[] = [];
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    keys.push(line.slice(0, eq).trim());
  }
  return keys;
}

describe('env coverage', () => {
  it('.env.example lists every key consumed by serverEnv and clientEnv schemas', async () => {
    const exampleKeys = await loadDotenvKeys('.env.example');
    const exampleSet = new Set(exampleKeys);

    const schemaKeys = new Set<string>([
      ...Object.keys(serverEnvSchema.shape),
      ...Object.keys(clientEnvSchema.shape),
    ]);
    // NODE_ENV is set by the framework / test runner — never something a
    // contributor would copy out of `.env.example`.
    schemaKeys.delete('NODE_ENV');

    const missing = Array.from(schemaKeys).filter((key) => !exampleSet.has(key));
    expect(
      missing,
      `keys present in env schemas but missing from .env.example: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('.env.example does not list keys that the schemas do not parse', async () => {
    const exampleKeys = await loadDotenvKeys('.env.example');
    const schemaKeys = new Set<string>([
      ...Object.keys(serverEnvSchema.shape),
      ...Object.keys(clientEnvSchema.shape),
    ]);

    const stale = exampleKeys.filter((key) => !schemaKeys.has(key));
    expect(
      stale,
      `keys present in .env.example but not declared in env schemas: ${stale.join(', ')}`,
    ).toEqual([]);
  });
});
