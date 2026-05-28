// ---------------------------------------------------------------------------
// Gemini model pricing — maps model identifiers to USD cost per million tokens.
//
// Used by the transcription pipeline to compute `transcription_cost_usd` and
// `llm_cost_usd` from `response.usageMetadata`. When `usageMetadata` is
// unavailable or the model is unknown, cost columns remain NULL (design
// decision D12: graceful degradation, never block the pipeline on pricing).
//
// Bump `PRICING_VERSION` whenever rates change so downstream consumers
// (analytics, billing) can partition by pricing era.
// ---------------------------------------------------------------------------

/**
 * Monotonically increasing version — bump on every pricing table change.
 * Stored alongside cost values so historical records can be attributed to
 * the rate table that was active at the time.
 */
export const PRICING_VERSION = 1;

/** Per-model cost rates in USD per million tokens (paid tier, text). */
interface ModelPricing {
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
}

/**
 * Lookup table keyed by the model identifier string returned by the Gemini
 * API (and configured via `serverEnv.GEMINI_MODEL_TRANSCRIPTION` /
 * `serverEnv.GEMINI_MODEL_NOTE`).
 *
 * Source: https://ai.google.dev/gemini-api/docs/pricing (paid tier, text).
 * Last verified: 2025-05 (pricing version 1).
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  'gemini-2.0-flash': {
    inputUsdPerMillionTokens: 0.1,
    outputUsdPerMillionTokens: 0.4,
  },
  'gemini-2.5-flash-lite': {
    inputUsdPerMillionTokens: 0.1,
    outputUsdPerMillionTokens: 0.4,
  },
  'gemini-2.5-flash': {
    inputUsdPerMillionTokens: 0.3,
    outputUsdPerMillionTokens: 2.5,
  },
  'gemini-2.5-pro': {
    inputUsdPerMillionTokens: 1.25,
    outputUsdPerMillionTokens: 10.0,
  },
  'gemini-3.5-flash': {
    inputUsdPerMillionTokens: 1.5,
    outputUsdPerMillionTokens: 9.0,
  },
};

// ---------------------------------------------------------------------------
// Cost computation
// ---------------------------------------------------------------------------

interface ComputeCostInput {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Computes the total USD cost for a Gemini API call based on token counts
 * and the model's pricing table entry.
 *
 * Returns `null` when the model is not in the pricing table — callers
 * should treat this as "cost unknown" and leave the DB column NULL rather
 * than guessing.
 */
export function computeCost({ model, inputTokens, outputTokens }: ComputeCostInput): number | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;

  const inputCost = (inputTokens / 1_000_000) * pricing.inputUsdPerMillionTokens;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputUsdPerMillionTokens;

  return inputCost + outputCost;
}
