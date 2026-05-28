import 'server-only';

import { z } from 'zod';

import { GeneratedNoteSchema } from '@/modules/ai-transcription/lib/schemas';

/**
 * Required top-level keys in the generated JSON Schema. If any of these is
 * missing from the `required` array it means the Zod schema drifted and
 * Gemini would accept responses missing critical fields.
 */
const REQUIRED_KEYS = [
  'schemaVersion',
  'pauta',
  'conteudoTrabalhado',
  'tarefaCasa',
  'palavrasRisco',
] as const;

/**
 * Converts `GeneratedNoteSchema` to a JSON Schema object suitable for
 * Gemini's `responseJsonSchema` config option.
 *
 * Design decision D3 ("double-defense"): Gemini receives this JSON Schema to
 * constrain its output structure, and we also validate the response with Zod
 * on our side. This function is the Gemini-facing half of that contract.
 *
 * Uses Zod 4's built-in `z.toJSONSchema()` instead of the third-party
 * `zod-to-json-schema` because the latter uses the `zod/v3` compat layer
 * which cannot introspect Zod 4 native schemas (produces empty definitions).
 *
 * - The `$schema` key is stripped because Gemini rejects it.
 * - A boot-time sanity check throws if any of the critical required keys are
 *   missing, catching Zod schema drift before it reaches production.
 */
function buildGeminiNoteJsonSchema(): Record<string, unknown> {
  const raw = z.toJSONSchema(GeneratedNoteSchema) as Record<string, unknown>;

  // Strip $schema — Gemini does not accept it.
  delete raw['$schema'];

  return raw;
}

/**
 * Validates that the generated JSON Schema contains the expected required
 * keys. Throws at module evaluation time if the schema drifted.
 */
function assertRequiredKeysPresent(schema: Record<string, unknown>): void {
  const required = schema['required'] as string[] | undefined;

  if (!Array.isArray(required)) {
    throw new Error(
      'GeminiNoteJsonSchema boot check failed: `required` array not found in generated JSON Schema.',
    );
  }

  const missing = REQUIRED_KEYS.filter((key) => !required.includes(key));

  if (missing.length > 0) {
    throw new Error(
      `GeminiNoteJsonSchema boot check failed: required keys missing: ${missing.join(', ')}. ` +
        'This means GeneratedNoteSchema drifted — update the Zod schema or REQUIRED_KEYS.',
    );
  }
}

// ---------------------------------------------------------------------------
// Module-level evaluation: build + validate once on first import.
// ---------------------------------------------------------------------------

export const GeminiNoteJsonSchema: Record<string, unknown> = buildGeminiNoteJsonSchema();

assertRequiredKeysPresent(GeminiNoteJsonSchema);
