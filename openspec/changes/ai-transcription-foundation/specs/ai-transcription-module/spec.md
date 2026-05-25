## ADDED Requirements

### Requirement: `src/modules/ai-transcription/` follows the module shape convention

The system SHALL provide a new domain module at `src/modules/ai-transcription/` with the structure documented in `CLAUDE.md`: `index.ts` (barrel — public API), `edge.ts` (edge-safe entrypoint for middleware consumers), `lib/` (Zod schemas, branded types, helpers), `server/` (placeholder `index.ts` to be populated by downstream changes), and no `components/` yet (UI lives in future changes).

#### Scenario: External consumers import only from the barrel
- **WHEN** a file outside `src/modules/ai-transcription/` imports anything from the module
- **THEN** it SHALL import from `@/modules/ai-transcription` (the `index.ts` barrel)
- **AND** SHALL NOT reach into internal paths such as `@/modules/ai-transcription/lib/...`

#### Scenario: `edge.ts` is free of Node-only deps
- **WHEN** the middleware (Edge runtime) imports from `@/modules/ai-transcription/edge`
- **THEN** the resolution graph SHALL NOT include `postgres-js`, `drizzle-orm/postgres-js`, `pino` (with transports), `@google/genai`, or any module that calls `node:crypto` at evaluation time
- **AND** the dev server SHALL boot without an Edge runtime error

### Requirement: Canonical Zod schemas and branded types live in `lib/`

The module SHALL expose, via its barrel:

- `TranscriptionStatusSchema` — Zod enum matching the DB CHECK (`pending | transcribing | generating | ready | reviewed | failed`).
- `TranscriptionSourceSchema` — Zod enum (`video_session | manual_upload`).
- `TranscriptionTemplateSchema` — Zod enum (`tcc | psicanalise | sistemica | aba | livre`).
- `RiskSensitivitySchema` — Zod enum (`low | medium | high`).
- `GeneratedNoteSchema` — Zod object versioned via `schemaVersion: z.literal(1)`, with required `humorInicial: z.string().nullable()`, `humorFinal: z.string().nullable()`, `pauta: z.array(z.string())`, `conteudoTrabalhado: z.array(z.string())`, `tarefaCasa: z.array(z.string())`, `palavrasRisco: z.array(z.string())`, `observacoesExtras: z.string().nullable()`.
- `RiskAlertSchema` — Zod object `{ kind: 'suicidal' | 'self_harm' | 'domestic_violence' | 'third_party_risk' | 'substance_abuse', excerpt: z.string().max(500), confidence: 'low' | 'medium' | 'high' }`.
- Branded types `TranscriptionId = z.infer<...>` derived from `z.string().uuid().brand<'TranscriptionId'>()`.

#### Scenario: Schemas are the single source of truth
- **WHEN** a Server Action reads a row's `generated_note` jsonb from the database
- **THEN** it MUST run `GeneratedNoteSchema.safeParse(row.generated_note)` before returning to the caller
- **AND** any drift (e.g., missing field) yields a logged warning without exposing payload contents

#### Scenario: Branded IDs prevent mixing
- **WHEN** a function signature accepts `TranscriptionId`
- **THEN** passing a raw `string` (or a `PatientId`) is a TypeScript compile error

### Requirement: `pseudonymizeTranscript` helper redacts patient identity before any prompt

The system SHALL expose `pseudonymizeTranscript(input: { patientFirstName: string; patientFullName: string; transcript: string }): string` via the module barrel. The helper SHALL replace, case-insensitively, every occurrence of `patientFirstName` and `patientFullName` (and any whole-word substring of `patientFullName` longer than 2 chars) with the literal `Paciente`. The helper SHALL NOT mutate the input string and SHALL NOT log either the input or the output.

#### Scenario: First and full name replaced
- **GIVEN** `patientFirstName = 'Maria'`, `patientFullName = 'Maria Souza Lima'`
- **WHEN** `pseudonymizeTranscript` runs on `'A Maria disse que viu a Souza Lima ontem.'`
- **THEN** the output is `'A Paciente disse que viu a Paciente ontem.'`

#### Scenario: Case-insensitive
- **GIVEN** `patientFirstName = 'Maria'`
- **WHEN** the transcript contains `'maria'`, `'MARIA'`, `'Maria'`
- **THEN** all three are replaced

#### Scenario: Short tokens are not over-replaced
- **GIVEN** `patientFullName = 'Lu Fé'`
- **WHEN** the transcript contains `'a luz'` (which includes `lu`)
- **THEN** the substring `lu` inside `luz` is NOT replaced (helper requires whole-word match of length > 2)

#### Scenario: Helper is pure
- **WHEN** called twice with the same input
- **THEN** it returns equal outputs and produces no side effects (no log lines, no I/O)

### Requirement: `createTranscriptionLogger` factory wraps Pino with redaction by default

The system SHALL expose `createTranscriptionLogger(context: { transcriptionId?: TranscriptionId; userId?: string }): Logger` via the module barrel. The returned logger SHALL be a Pino child of the project root logger configured with `redact: { paths: ['transcript', 'generatedNote', 'riskAlerts', 'patientName', 'patientFirstName', 'patientFullName', 'audioObjectKey', 'audioUrl', 'signedUrl', 'rawGeminiResponse', 'prompt'], censor: '[REDACTED]' }`.

#### Scenario: Sensitive paths are redacted
- **WHEN** code calls `logger.info({ patientName: 'Maria', generatedNote: { pauta: ['x'] } }, 'msg')`
- **THEN** the serialized log line contains `"patientName":"[REDACTED]"` and `"generatedNote":"[REDACTED]"`
- **AND** the string `Maria` does NOT appear anywhere in the line

#### Scenario: Non-sensitive fields are preserved
- **WHEN** code calls `logger.info({ transcriptionId: 't1', status: 'ready', durationMs: 1234 }, 'completed')`
- **THEN** all three values appear in plaintext in the log line

#### Scenario: Logger is the only one exported
- **WHEN** a future Server Action under `src/modules/ai-transcription/server/` needs to log
- **THEN** it SHALL use `createTranscriptionLogger` (imported from the barrel)
- **AND** SHALL NOT import `pino` directly nor use `console.*`

### Requirement: `server/` exports a stable placeholder via the module barrel

The module SHALL provide `src/modules/ai-transcription/server/index.ts` as a placeholder file that re-exports nothing user-facing yet (so that downstream changes can add Server Actions without first creating the folder). The top-level `src/modules/ai-transcription/index.ts` SHALL re-export from `lib/` (schemas, helpers, branded types) and from `server/` (currently empty).

#### Scenario: Barrel imports do not break
- **WHEN** another module does `import { GeneratedNoteSchema, pseudonymizeTranscript, createTranscriptionLogger } from '@/modules/ai-transcription'`
- **THEN** all three symbols resolve
