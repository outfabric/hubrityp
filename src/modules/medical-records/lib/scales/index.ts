/**
 * Scale library registry.
 *
 * Aggregates every psychometric instrument the platform supports and
 * provides a lookup helper for use by Server Actions and the public
 * patient-facing form. All definitions are pure (no I/O) and safe to
 * import on both server and client.
 */

import { audit } from './audit';
import { gad7 } from './gad7';
import { phq9 } from './phq9';
import { sdq } from './sdq';
import type { ScaleDefinition } from './types';
import { whoqolBref } from './whoqol-bref';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** All scales the platform currently supports. */
export const AVAILABLE_SCALES: ScaleDefinition[] = [phq9, gad7, sdq, audit, whoqolBref];

/** Union of every registered scale key. */
export type ScaleKey = 'phq9' | 'gad7' | 'sdq' | 'audit' | 'whoqol-bref';

/** Typed array of scale key strings — useful for Zod enums and iteration. */
export const SCALE_KEYS = ['phq9', 'gad7', 'sdq', 'audit', 'whoqol-bref'] as const;

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/** Retrieve a scale definition by its key, or `undefined` if not found. */
export function scaleByKey(key: string): ScaleDefinition | undefined {
  return AVAILABLE_SCALES.find((s) => s.key === key);
}

// Re-export individual scales and types for convenience
export { audit, gad7, phq9, sdq, whoqolBref };
export type { ClassificationResult, ScaleDefinition, ScaleOption, ScaleQuestion } from './types';
