/**
 * Pseudonymization end-to-end assertion.
 *
 * Validates the LGPD pseudonymization contract across the full
 * process-audio-transcription pipeline:
 *
 *   (a) The transcription step's Gemini call receives ONLY audio data —
 *       no patient name or PII in contents or systemInstruction.
 *   (b) The note generation step's Gemini call receives a pseudonymized
 *       transcript where patient names are replaced with "Paciente".
 *   (c) No log line over the entire pipeline run contains the patient's
 *       real name (captures pino destination).
 */

import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock: Inngest client
// ---------------------------------------------------------------------------

vi.mock('@/modules/ai-transcription/inngest/client', () => ({
  inngest: {
    createFunction: vi.fn((_config: unknown, handler: (...args: unknown[]) => unknown) => handler),
  },
}));

// ---------------------------------------------------------------------------
// Mock: Drizzle DB
// ---------------------------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();

vi.mock('@/shared/db/client', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args) as unknown,
    update: (...args: unknown[]) => mockDbUpdate(...args) as unknown,
  },
}));

// ---------------------------------------------------------------------------
// Mock: Drizzle ORM operators
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (a: unknown, b: unknown) => ({ type: 'eq', a, b }),
  inArray: (a: unknown, b: unknown) => ({ type: 'inArray', a, b }),
}));

// ---------------------------------------------------------------------------
// Mock: Supabase Storage + Realtime
// ---------------------------------------------------------------------------

const mockStorageDownload = vi.fn();
const mockStorageFrom = vi.fn(() => ({
  download: mockStorageDownload,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: { from: mockStorageFrom },
    channel: vi.fn(() => ({
      send: vi.fn().mockResolvedValue(undefined),
    })),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ---------------------------------------------------------------------------
// Mock: Gemini client — captures every generateContent call
// ---------------------------------------------------------------------------

const mockGenerateContent = vi.fn();
const mockFilesUpload = vi.fn();
const mockFilesDelete = vi.fn();

vi.mock('@/modules/ai-transcription/server/gemini-client', () => ({
  getGeminiClient: vi.fn(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
    files: {
      upload: mockFilesUpload,
      delete: mockFilesDelete,
    },
  })),
  createPartFromUri: vi.fn((uri: string, mimeType: string) => ({
    fileData: { fileUri: uri, mimeType },
  })),
  HarmBlockThreshold: { BLOCK_ONLY_HIGH: 'BLOCK_ONLY_HIGH' },
  HarmCategory: {
    HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
    HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
    HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
  },
}));

// ---------------------------------------------------------------------------
// Mock: Gemini SDK exports
// ---------------------------------------------------------------------------

vi.mock('@google/genai', () => ({
  createPartFromUri: vi.fn((uri: string, mimeType: string) => ({
    fileData: { fileUri: uri, mimeType },
  })),
  HarmBlockThreshold: { BLOCK_ONLY_HIGH: 'BLOCK_ONLY_HIGH' },
  HarmCategory: {
    HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
    HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
    HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
  },
}));

// ---------------------------------------------------------------------------
// Mock: Environment
// ---------------------------------------------------------------------------

vi.mock('@/shared/env', () => ({
  serverEnv: {
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    AI_TRANSCRIPTION_BUCKET: 'ai-transcription-audio',
    GEMINI_MODEL_TRANSCRIPTION: 'gemini-3.5-flash',
    GEMINI_MODEL_NOTE: 'gemini-3.5-flash',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  },
}));

vi.mock('@/shared/env/client', () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  },
}));

// ---------------------------------------------------------------------------
// Mock: Logger — captures every log line for PII assertion
// ---------------------------------------------------------------------------

/** Accumulates every argument passed to any log method over the pipeline run. */
const capturedLogArgs: unknown[] = [];

function createCapturingLogMethod() {
  return vi.fn((...args: unknown[]) => {
    capturedLogArgs.push(...args);
  });
}

const mockChildLogger = {
  info: createCapturingLogMethod(),
  error: createCapturingLogMethod(),
  warn: createCapturingLogMethod(),
  debug: createCapturingLogMethod(),
  trace: createCapturingLogMethod(),
  fatal: createCapturingLogMethod(),
  child: vi.fn(),
};

// The child's own .child() returns itself (pipeline does not nest further)
mockChildLogger.child.mockReturnValue(mockChildLogger);

vi.mock('@/modules/ai-transcription/lib/logger', () => ({
  createTranscriptionLogger: vi.fn(() => mockChildLogger),
}));

// ---------------------------------------------------------------------------
// Mock: Consent helper
// ---------------------------------------------------------------------------

const mockAssertConsent = vi.fn();

vi.mock('@/modules/ai-transcription/lib/consent', () => ({
  assertAiConsentActive: (...args: unknown[]) => mockAssertConsent(...args) as unknown,
}));

// ---------------------------------------------------------------------------
// Mock: Patients table
// ---------------------------------------------------------------------------

vi.mock('@/shared/db/schema/patients/tables', () => ({
  patients: {
    id: 'patients.id',
    userId: 'patients.user_id',
    fullName: 'patients.full_name',
  },
  consentTerms: {},
}));

// ---------------------------------------------------------------------------
// Mock: AI Transcription tables
// ---------------------------------------------------------------------------

vi.mock('@/shared/db/schema/ai-transcription/tables', () => ({
  aiTranscriptions: {
    id: 'ai_transcriptions.id',
    userId: 'ai_transcriptions.user_id',
    status: 'ai_transcriptions.status',
    audioObjectKey: 'ai_transcriptions.audio_object_key',
    generatedNote: 'ai_transcriptions.generated_note',
    riskAlerts: 'ai_transcriptions.risk_alerts',
    templateUsed: 'ai_transcriptions.template_used',
    transcriptionCostUsd: 'ai_transcriptions.transcription_cost_usd',
    llmCostUsd: 'ai_transcriptions.llm_cost_usd',
    completedAt: 'ai_transcriptions.completed_at',
    updatedAt: 'ai_transcriptions.updated_at',
  },
  aiTranscriptionSettings: {
    userId: 'ai_transcription_settings.user_id',
    defaultTemplate: 'ai_transcription_settings.default_template',
    riskDetectionSensitivity: 'ai_transcription_settings.risk_detection_sensitivity',
  },
}));

// ---------------------------------------------------------------------------
// Mock: Prompts
// ---------------------------------------------------------------------------

vi.mock('@/modules/ai-transcription/server/prompts', () => ({
  TRANSCRIPTION_SYSTEM_INSTRUCTION: 'Transcreva o audio...',
  TRANSCRIPTION_PROMPT_VERSION: 1,
  getNotePromptModule: vi.fn(() => ({
    PROMPT_VERSION: 1,
    buildSystemInstruction: vi.fn(() => 'System instruction for note generation'),
  })),
}));

// ---------------------------------------------------------------------------
// Mock: JSON Schema
// ---------------------------------------------------------------------------

vi.mock('@/modules/ai-transcription/server/json-schemas/gemini-note', () => ({
  GeminiNoteJsonSchema: { type: 'object', properties: {} },
}));

// ---------------------------------------------------------------------------
// Mock: Realtime broadcast
// ---------------------------------------------------------------------------

const mockBroadcastAiReady = vi.fn().mockResolvedValue(undefined);

vi.mock('@/modules/ai-transcription/server/realtime/broadcast', () => ({
  broadcastAiReady: (...args: unknown[]) => mockBroadcastAiReady(...args) as unknown,
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Patient name that appears 3 times in the transcript fixture.
 * The pipeline extracts the first name ("Maria") from the full name internally.
 */
const PATIENT_FULL_NAME = 'Maria Souza Lima';

/**
 * Simulated Gemini transcription output that mentions the patient's first
 * name 3 times and one surname once, mimicking a real clinical session.
 */
const TRANSCRIPT_WITH_PATIENT_NAME = [
  'Maria disse que esta se sentindo muito ansiosa ultimamente.',
  'Ela mencionou que Maria nao consegue dormir direito.',
  'Sobre a familia, Maria falou que Souza sempre a apoia.',
].join(' ');

const VALID_NOTE_JSON = JSON.stringify({
  schemaVersion: 1,
  humorInicial: '7',
  humorFinal: '8',
  pauta: ['Ansiedade no trabalho'],
  conteudoTrabalhado: ['Reestruturacao cognitiva'],
  tarefaCasa: ['Registro de pensamentos'],
  palavrasRisco: [],
  observacoesExtras: null,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAudioBlob(sizeBytes = 1024): Blob {
  const buf = new Uint8Array(sizeBytes);
  return new Blob([buf], { type: 'audio/webm' });
}

function chainableSelect(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}

function chainableUpdate() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  };
}

function buildStepContext() {
  return {
    run: vi.fn((_name: string, fn: () => unknown) => Promise.resolve(fn())),
    sendEvent: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let handler: (ctx: { event: unknown; step: unknown }) => Promise<unknown>;

beforeEach(async () => {
  vi.clearAllMocks();

  // Reset captured log args
  capturedLogArgs.length = 0;

  const mod = await import('@/modules/ai-transcription/inngest/process-audio-transcription');
  handler = mod.processAudioTranscription as unknown as typeof handler;

  mockDbSelect.mockReturnValue(chainableSelect([]));
  mockDbUpdate.mockReturnValue(chainableUpdate());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Setup all mocks for the full pipeline with our specific patient name
// ---------------------------------------------------------------------------

function setupPipelineMocks(opts: { userId: string; transcriptionId: string }) {
  const { userId, transcriptionId } = opts;

  // Step 1: consent active
  mockAssertConsent.mockResolvedValue({
    ok: true,
    termId: randomUUID(),
    signedAt: new Date(),
    templateVersion: 1,
  });

  // DB select chain: audio key → patient lookup → settings → settings re-load
  mockDbSelect
    .mockReturnValueOnce(chainableSelect([{ audioObjectKey: `${userId}/${transcriptionId}.webm` }]))
    .mockReturnValueOnce(chainableSelect([{ fullName: PATIENT_FULL_NAME }]))
    .mockReturnValueOnce(
      chainableSelect([{ defaultTemplate: 'tcc', riskDetectionSensitivity: 'medium' }]),
    )
    .mockReturnValueOnce(chainableSelect([{ defaultTemplate: 'tcc' }]));

  // Storage download
  mockStorageDownload.mockResolvedValue({
    data: makeAudioBlob(1024),
    error: null,
  });

  // Step 5: Gemini transcription — returns text that mentions patient name
  mockGenerateContent.mockResolvedValueOnce({
    text: TRANSCRIPT_WITH_PATIENT_NAME,
    candidates: [{ finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
  });

  // Step 8: Gemini note generation — returns valid note JSON
  mockGenerateContent.mockResolvedValueOnce({
    text: VALID_NOTE_JSON,
    candidates: [{ finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 100 },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Pseudonymization end-to-end (LGPD)', () => {
  it('(a) transcription step receives only audio data — no patient name in contents or systemInstruction', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    setupPipelineMocks({ userId, transcriptionId });

    const event = {
      data: {
        transcriptionId,
        userId,
        patientId,
        source: 'manual_upload' as const,
      },
    };
    const step = buildStepContext();

    await handler({ event, step });

    // First generateContent call = transcription step
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);

    const transcriptionCall = mockGenerateContent.mock.calls[0] as [
      {
        contents: unknown;
        config: { systemInstruction: string };
      },
    ];
    expect(transcriptionCall).toBeDefined();

    // Serialize the entire call to check for patient name leakage
    const transcriptionCallJson = JSON.stringify(transcriptionCall);

    // The transcription step should NOT contain any part of the patient's name
    expect(transcriptionCallJson).not.toContain('Maria');
    expect(transcriptionCallJson).not.toContain('Souza');
    expect(transcriptionCallJson).not.toContain('Lima');

    // The contents should be audio data (inlineData or fileData), not text
    const transcriptionContents = transcriptionCall[0].contents;
    expect(transcriptionContents).toEqual([
      {
        role: 'user',
        parts: [
          expect.objectContaining({
            inlineData: expect.objectContaining({
              mimeType: 'audio/webm',
            }),
          }),
        ],
      },
    ]);

    // System instruction is the generic transcription instruction, no patient info
    const systemInstruction = transcriptionCall[0].config.systemInstruction;
    expect(systemInstruction).not.toContain('Maria');
    expect(systemInstruction).not.toContain('Souza');
    expect(systemInstruction).not.toContain('Lima');
  });

  it('(b) note generation step receives pseudonymized transcript — "Paciente" replaces every name token', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    setupPipelineMocks({ userId, transcriptionId });

    const event = {
      data: {
        transcriptionId,
        userId,
        patientId,
        source: 'manual_upload' as const,
      },
    };
    const step = buildStepContext();

    await handler({ event, step });

    // Second generateContent call = note generation step
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);

    const noteCall = mockGenerateContent.mock.calls[1] as [
      {
        contents: unknown;
        config: { systemInstruction: string };
      },
    ];
    expect(noteCall).toBeDefined();

    // Serialize the contents to check for name leakage
    const noteContents =
      typeof noteCall[0].contents === 'string'
        ? noteCall[0].contents
        : JSON.stringify(noteCall[0].contents);

    // Must NOT contain the patient's name tokens (first name, each surname)
    expect(noteContents).not.toContain('Maria');
    expect(noteContents).not.toContain('Souza');
    expect(noteContents).not.toContain('Lima');

    // Must contain the pseudonymization replacement
    expect(noteContents).toContain('Paciente');

    // Also assert system instruction is clean (it should never have the name)
    const systemInstruction = noteCall[0].config.systemInstruction;
    expect(systemInstruction).not.toContain('Maria');
    expect(systemInstruction).not.toContain('Souza');
    expect(systemInstruction).not.toContain('Lima');
  });

  it('(c) no log line over the whole pipeline run contains the patient name', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    setupPipelineMocks({ userId, transcriptionId });

    const event = {
      data: {
        transcriptionId,
        userId,
        patientId,
        source: 'manual_upload' as const,
      },
    };
    const step = buildStepContext();

    await handler({ event, step });

    // Verify log methods were actually called (pipeline does log status transitions)
    const totalLogCalls =
      mockChildLogger.info.mock.calls.length +
      mockChildLogger.error.mock.calls.length +
      mockChildLogger.warn.mock.calls.length +
      mockChildLogger.debug.mock.calls.length;
    expect(totalLogCalls).toBeGreaterThan(0);

    // Serialize ALL captured log arguments into a single string for name search.
    // This catches PII in structured log objects (key values), format strings,
    // and any other argument position.
    const allLogContent = JSON.stringify(capturedLogArgs);

    // No part of the patient's real name may appear in any log line
    expect(allLogContent).not.toContain('Maria');
    expect(allLogContent).not.toContain('Souza');
    expect(allLogContent).not.toContain('Lima');
  });
});
