/**
 * Shared type definitions for psychometric scale instruments.
 *
 * Every scale in the library (PHQ-9, GAD-7, SDQ, AUDIT, WHOQOL-Bref)
 * implements `ScaleDefinition`. The `score` / `classify` methods are
 * pure functions — no I/O, no side-effects — so they can run on
 * server or client without restriction.
 */

export interface ScaleOption {
  value: number;
  label: string;
}

export interface ScaleQuestion {
  id: string;
  prompt: string;
  options: ScaleOption[];
  /** When true the item is reverse-scored before summing (e.g. SDQ prosocial). */
  reverseScored?: boolean;
}

export interface ClassificationResult {
  label: string;
  /** 'domains' is reserved for WHOQOL-Bref which produces per-domain scores. */
  severity: 'minimal' | 'mild' | 'moderate' | 'severe' | 'domains';
}

export interface ScaleDefinition {
  key: string;
  label: string;
  description: string;
  estimatedMinutes: number;
  questions: ScaleQuestion[];
  /** Returns total score, or null for scales without a single total (WHOQOL-Bref). */
  score(responses: Record<string, number>): number | null;
  classify(score: number | null, responses?: Record<string, number>): ClassificationResult;
}
