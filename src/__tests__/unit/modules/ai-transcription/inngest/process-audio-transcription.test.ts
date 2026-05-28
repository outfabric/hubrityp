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
// Mock: Gemini client
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
// Mock: Gemini SDK exports (direct import restricted but tests may need it)
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
    AI_TRANSCRIPTION_MAX_AUDIO_MB: 200,
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

const VALID_NOTE_WITH_RISK_JSON = JSON.stringify({
  schemaVersion: 1,
  humorInicial: '3',
  humorFinal: '5',
  pauta: ['Ideacao suicida'],
  conteudoTrabalhado: ['Plano de seguranca'],
  tarefaCasa: ['Ligar para CVV se necessario'],
  palavrasRisco: ['pensou em se matar', 'autolesao com cortes'],
  observacoesExtras: 'Paciente em risco',
});

function makeEvent(
  overrides?: Partial<{ transcriptionId: string; userId: string; patientId: string }>,
) {
  return {
    data: {
      transcriptionId: overrides?.transcriptionId ?? randomUUID(),
      userId: overrides?.userId ?? randomUUID(),
      patientId: overrides?.patientId ?? randomUUID(),
      source: 'manual_upload' as const,
    },
  };
}

function makeAudioBlob(sizeBytes = 1024): Blob {
  const buf = new Uint8Array(sizeBytes);
  return new Blob([buf], { type: 'audio/webm' });
}

// ---------------------------------------------------------------------------
// Helpers to create chainable mock DB
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let handler: (ctx: { event: unknown; step: unknown }) => Promise<unknown>;

beforeEach(async () => {
  vi.clearAllMocks();

  // The handler is the second arg to inngest.createFunction (our mock returns it directly)
  const mod = await import('@/modules/ai-transcription/inngest/process-audio-transcription');
  handler = mod.processAudioTranscription as unknown as typeof handler;

  // Default DB chain behavior
  mockDbSelect.mockReturnValue(chainableSelect([]));
  mockDbUpdate.mockReturnValue(chainableUpdate());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Step context builder
// ---------------------------------------------------------------------------

function buildStepContext() {
  return {
    run: vi.fn((_name: string, fn: () => unknown) => Promise.resolve(fn())),
    sendEvent: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Setup mocks for a full happy path
// ---------------------------------------------------------------------------

function setupHappyPathMocks(opts: {
  userId: string;
  patientId: string;
  transcriptionId: string;
  patientName?: string;
  template?: string;
  sensitivity?: string;
  noteJson?: string;
  transcriptText?: string;
}) {
  const {
    userId,
    transcriptionId,
    patientName = 'Maria Silva',
    template = 'tcc',
    sensitivity = 'medium',
    noteJson = VALID_NOTE_JSON,
    transcriptText = 'Paciente falou sobre ansiedade no trabalho.',
  } = opts;

  // Step 1: consent active
  mockAssertConsent.mockResolvedValue({
    ok: true,
    termId: randomUUID(),
    signedAt: new Date(),
    templateVersion: 1,
  });

  // Step 3: download audio — DB returns audio object key
  mockDbSelect
    .mockReturnValueOnce(chainableSelect([{ audioObjectKey: `${userId}/${transcriptionId}.webm` }]))
    // Step 6: patient lookup for pseudonymization
    .mockReturnValueOnce(chainableSelect([{ fullName: patientName }]))
    // Step 8: settings lookup
    .mockReturnValueOnce(
      chainableSelect([{ defaultTemplate: template, riskDetectionSensitivity: sensitivity }]),
    )
    // Step 12: settings re-load for persist
    .mockReturnValueOnce(chainableSelect([{ defaultTemplate: template }]));

  // Storage download
  mockStorageDownload.mockResolvedValue({
    data: makeAudioBlob(1024),
    error: null,
  });

  // Step 5: Gemini transcription
  mockGenerateContent.mockResolvedValueOnce({
    text: transcriptText,
    candidates: [{ finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
  });

  // Step 8: Gemini note generation
  mockGenerateContent.mockResolvedValueOnce({
    text: noteJson,
    candidates: [{ finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 100 },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processAudioTranscription', () => {
  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  it('completes the full pipeline on happy path', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    setupHappyPathMocks({ userId, patientId, transcriptionId });

    const event = makeEvent({ userId, patientId, transcriptionId });
    const step = buildStepContext();

    const result = await handler({ event, step });

    expect(result).toEqual({ status: 'completed', transcriptionId });
    expect(mockAssertConsent).toHaveBeenCalledOnce();
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(mockBroadcastAiReady).toHaveBeenCalledOnce();
  });

  // -----------------------------------------------------------------------
  // Consent inactive → NonRetriableError, no DB writes after
  // -----------------------------------------------------------------------

  it('throws NonRetriableError when consent is inactive', async () => {
    const event = makeEvent();
    const step = buildStepContext();

    mockAssertConsent.mockResolvedValue({ ok: false, reason: 'revoked' });

    await expect(handler({ event, step })).rejects.toThrow('CONSENT_INACTIVE');

    // No Gemini calls should happen
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Pseudonymization applied — assert no patient name in prompt
  // -----------------------------------------------------------------------

  it('pseudonymizes the transcript before sending to note generation', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    setupHappyPathMocks({
      userId,
      patientId,
      transcriptionId,
      patientName: 'Maria Silva',
      transcriptText: 'Maria disse que esta ansiosa. Silva tambem falou sobre trabalho.',
    });

    const event = makeEvent({ userId, patientId, transcriptionId });
    const step = buildStepContext();

    await handler({ event, step });

    // The second generateContent call receives the pseudonymized transcript
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    const noteCall = mockGenerateContent.mock.calls[1] as [{ contents: unknown }];
    expect(noteCall).toBeDefined();

    const noteContents =
      typeof noteCall[0].contents === 'string'
        ? noteCall[0].contents
        : JSON.stringify(noteCall[0].contents);
    expect(noteContents).not.toContain('Maria');
    expect(noteContents).not.toContain('Silva');
    expect(noteContents).toContain('Paciente');
  });

  // -----------------------------------------------------------------------
  // Invalid JSON response → retriable error
  // -----------------------------------------------------------------------

  it('throws retriable error when Gemini returns invalid JSON for note', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    // Setup with invalid JSON note response
    mockAssertConsent.mockResolvedValue({
      ok: true,
      termId: randomUUID(),
      signedAt: new Date(),
      templateVersion: 1,
    });

    mockDbSelect
      .mockReturnValueOnce(
        chainableSelect([{ audioObjectKey: `${userId}/${transcriptionId}.webm` }]),
      )
      .mockReturnValueOnce(chainableSelect([{ fullName: 'Test Patient' }]))
      .mockReturnValueOnce(
        chainableSelect([{ defaultTemplate: 'livre', riskDetectionSensitivity: 'medium' }]),
      );

    mockStorageDownload.mockResolvedValue({
      data: makeAudioBlob(),
      error: null,
    });

    mockGenerateContent
      .mockResolvedValueOnce({
        text: 'Valid transcript text here.',
        candidates: [{ finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      })
      .mockResolvedValueOnce({
        text: 'this is not valid json at all',
        candidates: [{ finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 100 },
      });

    const event = makeEvent({ userId, patientId, transcriptionId });
    const step = buildStepContext();

    await expect(handler({ event, step })).rejects.toThrow('invalid_response_schema');
  });

  // -----------------------------------------------------------------------
  // Safety block → NonRetriableError
  // -----------------------------------------------------------------------

  it('throws NonRetriableError on Gemini safety block during transcription', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    mockAssertConsent.mockResolvedValue({
      ok: true,
      termId: randomUUID(),
      signedAt: new Date(),
      templateVersion: 1,
    });

    mockDbSelect.mockReturnValueOnce(
      chainableSelect([{ audioObjectKey: `${userId}/${transcriptionId}.webm` }]),
    );
    mockStorageDownload.mockResolvedValue({
      data: makeAudioBlob(),
      error: null,
    });

    // Gemini returns safety-blocked response
    mockGenerateContent.mockResolvedValueOnce({
      text: undefined,
      candidates: [{ finishReason: 'SAFETY' }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 0 },
    });

    const event = makeEvent({ userId, patientId, transcriptionId });
    const step = buildStepContext();

    await expect(handler({ event, step })).rejects.toThrow('GEMINI_SAFETY_BLOCK');
  });

  // -----------------------------------------------------------------------
  // Rate limit 429 → retriable error (not NonRetriable)
  // -----------------------------------------------------------------------

  it('throws retriable error on Gemini 429 rate limit', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    mockAssertConsent.mockResolvedValue({
      ok: true,
      termId: randomUUID(),
      signedAt: new Date(),
      templateVersion: 1,
    });

    mockDbSelect.mockReturnValueOnce(
      chainableSelect([{ audioObjectKey: `${userId}/${transcriptionId}.webm` }]),
    );
    mockStorageDownload.mockResolvedValue({
      data: makeAudioBlob(),
      error: null,
    });

    // Gemini throws 429
    const rateLimitError = new Error('429 RESOURCE_EXHAUSTED: Rate limit exceeded');
    mockGenerateContent.mockRejectedValueOnce(rateLimitError);

    const event = makeEvent({ userId, patientId, transcriptionId });
    const step = buildStepContext();

    // Should throw the original error (retriable), not a NonRetriableError
    await expect(handler({ event, step })).rejects.toThrow('429 RESOURCE_EXHAUSTED');
  });

  // -----------------------------------------------------------------------
  // Risk alerts extracted from palavrasRisco
  // -----------------------------------------------------------------------

  it('extracts risk alerts from generated note', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    // Track the persist-note update call
    const persistSetCalls: unknown[] = [];
    const mockPersistUpdate = {
      set: vi.fn((setArg: unknown) => {
        persistSetCalls.push(setArg);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    };

    setupHappyPathMocks({
      userId,
      patientId,
      transcriptionId,
      noteJson: VALID_NOTE_WITH_RISK_JSON,
    });

    // Override update mock to capture persist calls
    mockDbUpdate.mockReturnValue(mockPersistUpdate);

    const event = makeEvent({ userId, patientId, transcriptionId });
    const step = buildStepContext();

    await handler({ event, step });

    // Find the persist call that has riskAlerts
    const persistCall = persistSetCalls.find(
      (call) => typeof call === 'object' && call !== null && 'riskAlerts' in call,
    );
    expect(persistCall).toBeDefined();

    const riskAlerts = (persistCall as { riskAlerts: Array<{ kind: string }> }).riskAlerts;
    expect(riskAlerts).toHaveLength(2);
    expect(riskAlerts[0]!.kind).toBe('suicidal');
    expect(riskAlerts[1]!.kind).toBe('self_harm');
  });

  // -----------------------------------------------------------------------
  // Idempotent re-run — transitions are guarded by status WHERE clauses
  // -----------------------------------------------------------------------

  it('uses WHERE clauses for idempotent status transitions', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    setupHappyPathMocks({ userId, patientId, transcriptionId });

    // Track update where calls
    const updateWhereCalls: unknown[] = [];
    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn((...args: unknown[]) => {
          updateWhereCalls.push(args);
          return Promise.resolve([]);
        }),
      }),
    });

    const event = makeEvent({ userId, patientId, transcriptionId });
    const step = buildStepContext();

    await handler({ event, step });

    // Verify db.update was called with WHERE conditions (idempotent guards)
    expect(mockDbUpdate).toHaveBeenCalled();
    expect(updateWhereCalls.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Zod validation failure on note → retriable error
  // -----------------------------------------------------------------------

  it('throws retriable error when note fails Zod validation', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    mockAssertConsent.mockResolvedValue({
      ok: true,
      termId: randomUUID(),
      signedAt: new Date(),
      templateVersion: 1,
    });

    mockDbSelect
      .mockReturnValueOnce(
        chainableSelect([{ audioObjectKey: `${userId}/${transcriptionId}.webm` }]),
      )
      .mockReturnValueOnce(chainableSelect([{ fullName: 'Test Patient' }]))
      .mockReturnValueOnce(
        chainableSelect([{ defaultTemplate: 'livre', riskDetectionSensitivity: 'medium' }]),
      );

    mockStorageDownload.mockResolvedValue({
      data: makeAudioBlob(),
      error: null,
    });

    mockGenerateContent
      .mockResolvedValueOnce({
        text: 'Transcript.',
        candidates: [{ finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      })
      // Valid JSON but wrong schema (missing required fields)
      .mockResolvedValueOnce({
        text: JSON.stringify({ schemaVersion: 2, wrongField: true }),
        candidates: [{ finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 100 },
      });

    const event = makeEvent({ userId, patientId, transcriptionId });
    const step = buildStepContext();

    await expect(handler({ event, step })).rejects.toThrow('invalid_response_schema');
  });
});
