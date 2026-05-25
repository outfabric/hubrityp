## ADDED Requirements

### Requirement: Gemini and audio-storage env vars are declared and validated at boot

The system SHALL extend `src/shared/env/schemas.ts` to declare and validate the following SERVER-ONLY environment variables, all required at boot in production and dev unless a documented default is provided:

| Variable | Type | Default | Notes |
|---|---|---|---|
| `GEMINI_API_KEY` | non-empty string | — (REQUIRED) | Server-only; obtained from Google AI Studio |
| `GEMINI_MODEL_TRANSCRIPTION` | string matching `/^(gemini|gemma)-/` | `gemini-3.5-flash` | |
| `GEMINI_MODEL_NOTE` | string matching `/^(gemini|gemma)-/` | `gemini-3.5-flash` | |
| `AI_TRANSCRIPTION_BUCKET` | string | `ai-transcription-audio` | Must match the Storage bucket name |
| `AI_TRANSCRIPTION_AUDIO_TTL_HOURS` | int ≥ 24, ≤ 168 | `24` | Honors RN-10.03 / RNF-10.06 |
| `AI_TRANSCRIPTION_MAX_AUDIO_MB` | int ≥ 1, ≤ 500 | `200` | Honors RF-10.05 |

#### Scenario: Missing `GEMINI_API_KEY` blocks boot
- **GIVEN** `GEMINI_API_KEY` is absent
- **WHEN** the server starts
- **THEN** Zod validation fails and the process exits with a clear error pointing to the variable name
- **AND** no listener begins accepting traffic

#### Scenario: Defaults apply when not set
- **WHEN** only `GEMINI_API_KEY` is set
- **THEN** `serverEnv.GEMINI_MODEL_TRANSCRIPTION` is `'gemini-3.5-flash'` and `serverEnv.AI_TRANSCRIPTION_AUDIO_TTL_HOURS` is `24`

#### Scenario: Invalid TTL is rejected
- **GIVEN** `AI_TRANSCRIPTION_AUDIO_TTL_HOURS=12`
- **WHEN** boot validates env
- **THEN** boot fails with a Zod error indicating the minimum is 24

### Requirement: No Gemini or audio env var is exposed to the client bundle

The system SHALL NOT add any of the new env vars to `clientEnv` and SHALL NOT use a `NEXT_PUBLIC_` prefix for any of them. The ESLint rule that forbids direct `process.env.*` outside the allowlist SHALL remain green.

#### Scenario: Client bundle does not contain `GEMINI_API_KEY`
- **WHEN** the production build is generated
- **THEN** grepping the `.next/static/**` output for `GEMINI_API_KEY` or for the actual key value finds zero matches

#### Scenario: Direct `process.env` access in module code fails lint
- **WHEN** a developer writes `process.env.GEMINI_API_KEY` inside `src/modules/ai-transcription/`
- **THEN** ESLint reports an error and CI is red

### Requirement: `.env.example` documents the new variables without containing secrets

The system SHALL update `.env.example` to include the six new variables with descriptive placeholders (e.g., `GEMINI_API_KEY=<obtain at https://aistudio.google.com/apikey>`). Real values SHALL NOT appear in the example file.

#### Scenario: Example file is committed
- **WHEN** `git status` runs after `npm run db:migrate`
- **THEN** `.env.example` appears as modified and contains the six lines
- **AND** none of those lines contain a real key
