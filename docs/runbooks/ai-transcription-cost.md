# AI Transcription — Cost Tracking Runbook

Operational guide for monitoring and maintaining the per-call cost tracking built into the AI transcription pipeline.

## 1. Cost columns in `ai_transcriptions`

The pipeline records two cost values per completed transcription, stored as `NUMERIC(10,4)`:

| Column                   | What it tracks                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `transcription_cost_usd` | USD cost of the Gemini call that transcribed the audio (step 5: `run-transcription`).                                     |
| `llm_cost_usd`           | USD cost of the Gemini call that generated the clinical note from the pseudonymized transcript (step 8: `generate-note`). |

Both columns are **nullable by design** (design decision D12 — graceful degradation). They are `NULL` when:

- The model identifier returned by Gemini is not present in the pricing lookup table (`MODEL_PRICING` in `lib/pricing.ts`).
- `usageMetadata` was not included in the Gemini response (rare but possible).
- The transcription did not reach the persist step (failed or cancelled before step 12).

### Reading cost data

```sql
-- Total cost per psychologist (last 30 days)
SELECT
  user_id,
  COUNT(*) AS total_transcriptions,
  SUM(transcription_cost_usd::numeric) AS total_transcription_cost,
  SUM(llm_cost_usd::numeric) AS total_llm_cost,
  SUM(transcription_cost_usd::numeric + llm_cost_usd::numeric) AS total_cost
FROM ai_transcriptions
WHERE status = 'ready'
  AND completed_at > now() - INTERVAL '30 days'
  AND transcription_cost_usd IS NOT NULL
  AND llm_cost_usd IS NOT NULL
GROUP BY user_id
ORDER BY total_cost DESC;
```

```sql
-- Average cost per transcription, broken down by model
SELECT
  template_used,
  COUNT(*) AS n,
  AVG(transcription_cost_usd::numeric) AS avg_transcription_cost,
  AVG(llm_cost_usd::numeric) AS avg_llm_cost,
  AVG(transcription_cost_usd::numeric + llm_cost_usd::numeric) AS avg_total
FROM ai_transcriptions
WHERE status = 'ready'
  AND transcription_cost_usd IS NOT NULL
GROUP BY template_used
ORDER BY avg_total DESC;
```

```sql
-- Find transcriptions with NULL cost (model not in pricing table)
SELECT id, user_id, status, template_used, completed_at
FROM ai_transcriptions
WHERE status = 'ready'
  AND (transcription_cost_usd IS NULL OR llm_cost_usd IS NULL)
ORDER BY completed_at DESC
LIMIT 20;
```

---

## 2. How cost is computed

Cost computation happens in step 12 (`persist-note`) of `processAudioTranscription`. The pipeline calls `computeCost()` from `src/modules/ai-transcription/lib/pricing.ts` twice:

1. **Transcription cost**: uses the token counts from step 5 (`run-transcription`), keyed by `serverEnv.GEMINI_MODEL_TRANSCRIPTION`.
2. **LLM/note cost**: uses the token counts from step 8 (`generate-note`), keyed by `serverEnv.GEMINI_MODEL_NOTE`.

The `computeCost()` function:

1. Looks up the model identifier in `MODEL_PRICING`.
2. If the model is not found, returns `null` (cost unknown — never blocks the pipeline).
3. If found, computes: `(inputTokens / 1,000,000) * inputUsdPerMillionTokens + (outputTokens / 1,000,000) * outputUsdPerMillionTokens`.
4. The result is stored with 4 decimal places (`toFixed(4)`).

---

## 3. The pricing module (`lib/pricing.ts`)

Located at `src/modules/ai-transcription/lib/pricing.ts`, this file contains:

- **`PRICING_VERSION`** — monotonically increasing integer. Bump on every pricing table change so analytics/billing can partition cost data by the rate table that was active when the transcription was processed.
- **`MODEL_PRICING`** — a `Record<string, ModelPricing>` mapping Gemini model identifiers to input/output USD-per-million-token rates.
- **`computeCost()`** — pure function that takes `{ model, inputTokens, outputTokens }` and returns the total USD cost (or `null` if the model is unknown).

### Currently tracked models (pricing version 1)

| Model                   | Input (USD/M tokens) | Output (USD/M tokens) |
| ----------------------- | -------------------: | --------------------: |
| `gemini-2.0-flash`      |                 0.10 |                  0.40 |
| `gemini-2.5-flash-lite` |                 0.10 |                  0.40 |
| `gemini-2.5-flash`      |                 0.30 |                  2.50 |
| `gemini-2.5-pro`        |                 1.25 |                 10.00 |
| `gemini-3.5-flash`      |                 1.50 |                  9.00 |

Source: [Gemini API Pricing (paid tier, text)](https://ai.google.dev/gemini-api/docs/pricing).

---

## 4. How to bump pricing

When Google updates Gemini pricing or you add a new model to the pipeline, follow these steps:

### Step-by-step

1. **Verify new rates** against the [official pricing page](https://ai.google.dev/gemini-api/docs/pricing).
2. **Open `src/modules/ai-transcription/lib/pricing.ts`**.
3. **Bump `PRICING_VERSION`** — increment by 1 (e.g., `1` to `2`). This is important: downstream consumers use the version to attribute historical costs to the correct rate table.
4. **Update `MODEL_PRICING`**:
   - To change rates for an existing model: update `inputUsdPerMillionTokens` and/or `outputUsdPerMillionTokens`.
   - To add a new model: add a new entry with the model identifier string as the key (must match the value returned by the Gemini API and configured in `serverEnv.GEMINI_MODEL_TRANSCRIPTION` / `serverEnv.GEMINI_MODEL_NOTE`).
   - To retire a model: leave the entry in place (for historical lookups) and update the `Last verified` comment.
5. **Update the `Last verified` comment** at the top of `MODEL_PRICING` with the current date.
6. **Update this runbook** (section 3 table) to reflect the new rates and version.
7. **Run tests**: `npm run test:unit` covers `computeCost()` to verify the function still behaves correctly with the new rates.

### Important notes

- **Do NOT remove old model entries** from `MODEL_PRICING`. If a model was used historically, removing its entry causes `computeCost()` to return `null` for those rows if they are ever re-processed. Keep old entries for backward compatibility.
- **Pricing changes are forward-only.** Updating `MODEL_PRICING` only affects new transcriptions. Already-persisted `transcription_cost_usd` and `llm_cost_usd` values are not recalculated — they reflect the rate table that was active at processing time.
- **NULL costs after a model change** usually mean the new model identifier in `serverEnv.GEMINI_MODEL_TRANSCRIPTION` or `serverEnv.GEMINI_MODEL_NOTE` was not added to `MODEL_PRICING`. Check the query in section 1 and add the missing model entry.

---

## 5. Monitoring cost anomalies

### Sudden cost spike

A spike in per-transcription cost typically means one of:

- The configured model was changed to a more expensive one (check `serverEnv.GEMINI_MODEL_TRANSCRIPTION` / `serverEnv.GEMINI_MODEL_NOTE`).
- Audio files are significantly longer than usual (more input tokens).
- A prompt change increased output verbosity (more output tokens).

```sql
-- Daily cost trend (last 14 days)
SELECT
  DATE(completed_at) AS day,
  COUNT(*) AS transcriptions,
  SUM(transcription_cost_usd::numeric + llm_cost_usd::numeric) AS daily_total,
  AVG(transcription_cost_usd::numeric + llm_cost_usd::numeric) AS avg_per_transcription
FROM ai_transcriptions
WHERE status = 'ready'
  AND completed_at > now() - INTERVAL '14 days'
  AND transcription_cost_usd IS NOT NULL
  AND llm_cost_usd IS NOT NULL
GROUP BY DATE(completed_at)
ORDER BY day DESC;
```

### Many NULL cost rows

If a large percentage of completed transcriptions have `NULL` cost columns, the likely cause is a model identifier mismatch. Verify that the model strings in `serverEnv` match exactly the keys in `MODEL_PRICING`.
