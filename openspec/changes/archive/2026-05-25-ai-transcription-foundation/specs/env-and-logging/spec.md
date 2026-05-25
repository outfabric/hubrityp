## ADDED Requirements

### Requirement: `serverEnv` exposes six new AI-transcription variables

The system SHALL extend `serverEnv` (in `src/shared/env/index.ts`) to expose `GEMINI_API_KEY`, `GEMINI_MODEL_TRANSCRIPTION`, `GEMINI_MODEL_NOTE`, `AI_TRANSCRIPTION_BUCKET`, `AI_TRANSCRIPTION_AUDIO_TTL_HOURS`, and `AI_TRANSCRIPTION_MAX_AUDIO_MB`, all validated by the central env schema. These variables SHALL NOT leak into `clientEnv` and SHALL NOT appear in any `NEXT_PUBLIC_*` mapping.

#### Scenario: serverEnv types include the new fields
- **WHEN** a server-only file imports `serverEnv` from `@/shared/env`
- **THEN** TypeScript autocompletes the six new fields with the correct types

#### Scenario: clientEnv does NOT include the new fields
- **WHEN** a `'use client'` file imports `clientEnv`
- **THEN** none of the six fields are present on the type

### Requirement: A canonical transcription logger applies redaction by default

The system SHALL provide `createTranscriptionLogger(context)` (re-exported by `@/modules/ai-transcription`) as a thin wrapper over the root Pino logger configured with the redact paths listed in the `ai-transcription-module` capability. The factory SHALL be the only logger consumed by code under `src/modules/ai-transcription/server/**` and `src/modules/ai-transcription/inngest/**` (the latter is a future folder added by downstream changes).

#### Scenario: Redaction is non-bypassable for known sensitive fields
- **WHEN** a developer logs an object whose key matches one of the redacted paths
- **THEN** the serialized payload replaces the value with `[REDACTED]`
- **AND** an integration test asserting this is part of the change's test plan

#### Scenario: Direct Pino import inside the module is prevented by lint
- **WHEN** code under `src/modules/ai-transcription/**` imports `pino` directly
- **THEN** an ESLint `no-restricted-imports` rule (added by this change) reports an error
