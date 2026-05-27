import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToggleRecordingResult } from '@/modules/telepsicologia/server/toggle-recording';

// ---------------------------------------------------------------------------
// Mocks — declared before any import that transitively reaches the mocked
// modules. `vi.mock` is hoisted by Vitest, so declaration order is safe.
// ---------------------------------------------------------------------------

// Track queries to the db mock
let selectCallIndex = 0;
let selectResults: Record<string, unknown>[][] = [];

vi.mock('@/shared/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn(() => ({
          limit: vi.fn(() => {
            const result = selectResults[selectCallIndex] ?? [];
            selectCallIndex++;
            return Promise.resolve(result);
          }),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve()),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([])),
            })),
          })),
        })),
        insert: vi.fn(() => ({
          values: vi.fn(() => Promise.resolve()),
        })),
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve()),
          })),
        })),
      };
      await fn(tx);
    }),
  },
}));

// Mock assertAiConsentActive — controllable per test
let aiConsentResult: {
  ok: boolean;
  reason?: string;
  termId?: string;
  signedAt?: Date;
  templateVersion?: number;
} = {
  ok: true,
  termId: randomUUID(),
  signedAt: new Date(),
  templateVersion: 1,
};

vi.mock('@/modules/ai-transcription', () => ({
  assertAiConsentActive: vi.fn(() => Promise.resolve(aiConsentResult)),
}));

// Mock Stream SDK
const mockStartRecording = vi.fn().mockResolvedValue({});
const mockStopRecording = vi.fn().mockResolvedValue({});

vi.mock('@/modules/telepsicologia/server/stream-client', () => ({
  getStreamClient: () => ({
    video: {
      call: () => ({
        startRecording: mockStartRecording,
        stopRecording: mockStopRecording,
      }),
    },
  }),
}));

// Mock logger — capture warn calls to verify the transitional log
const mockLoggerWarn = vi.fn();

vi.mock('@/shared/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: mockLoggerWarn,
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock schemas (needed by toggle-recording import chain)
vi.mock('@/modules/telepsicologia/lib/schemas', () => ({
  toggleRecordingInputSchema: {
    safeParse: vi.fn((input: unknown) => {
      const inp = input as Record<string, unknown>;
      if (
        typeof inp?.room_id === 'string' &&
        /^[0-9a-f-]{36}$/.test(inp.room_id) &&
        (inp.action === 'start' || inp.action === 'stop')
      ) {
        return { success: true, data: { room_id: inp.room_id, action: inp.action } };
      }
      return {
        success: false,
        error: { flatten: () => ({ fieldErrors: { room_id: ['invalid'] } }) },
      };
    }),
  },
}));

// Mock Drizzle helpers — toggle-recording.ts imports these
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((a: unknown, b: unknown) => [a, b]),
  isNotNull: vi.fn((a: unknown) => a),
  isNull: vi.fn((a: unknown) => a),
}));

// Mock table schema imports — empty objects are sufficient for the mocked db
vi.mock('@/shared/db/schema/agenda/tables', () => ({
  sessions: { id: 'sessions.id', patientId: 'sessions.patientId' },
}));

vi.mock('@/shared/db/schema/patients/tables', () => ({
  patients: {
    id: 'patients.id',
    recordingConsentSignedAt: 'patients.recordingConsentSignedAt',
    recordingConsentRevokedAt: 'patients.recordingConsentRevokedAt',
  },
}));

vi.mock('@/shared/db/schema/telepsicologia/tables', () => ({
  videoRooms: {
    id: 'videoRooms.id',
    sessionId: 'videoRooms.sessionId',
    streamCallId: 'videoRooms.streamCallId',
    status: 'videoRooms.status',
    userId: 'videoRooms.userId',
    recordingEnabled: 'videoRooms.recordingEnabled',
  },
  videoRecordings: {
    id: 'videoRecordings.id',
    sessionId: 'videoRecordings.sessionId',
    userId: 'videoRecordings.userId',
    status: 'videoRecordings.status',
  },
  videoSessionLogs: {
    sessionId: 'videoSessionLogs.sessionId',
    userId: 'videoSessionLogs.userId',
    eventType: 'videoSessionLogs.eventType',
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOM_ID = randomUUID();
const USER_ID = randomUUID();
const SESSION_ID = randomUUID();
const PATIENT_ID = randomUUID();
const STREAM_CALL_ID = `session-${SESSION_ID}`;

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
}

/**
 * Set up DB mock select results for a full start-recording flow.
 * Call 1: room ownership check
 * Call 2: patient row lookup (for consent check)
 */
function setupDbForStart(opts: {
  roomExists: boolean;
  legacyConsentSignedAt: Date | null;
  legacyConsentRevokedAt: Date | null;
}) {
  selectCallIndex = 0;
  selectResults = [
    // Call 1: room ownership
    opts.roomExists
      ? [
          {
            id: ROOM_ID,
            sessionId: SESSION_ID,
            streamCallId: STREAM_CALL_ID,
            status: 'active',
          },
        ]
      : [],
    // Call 2: patient row lookup via join
    [
      {
        patientId: PATIENT_ID,
        recordingConsentSignedAt: opts.legacyConsentSignedAt,
        recordingConsentRevokedAt: opts.legacyConsentRevokedAt,
      },
    ],
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('toggleRecordingImpl — dual consent gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallIndex = 0;
    selectResults = [];
    aiConsentResult = {
      ok: true,
      termId: randomUUID(),
      signedAt: new Date(),
      templateVersion: 1,
    };
  });

  // -------------------------------------------------------------------------
  // (a) Both gates pass → recording starts
  // -------------------------------------------------------------------------

  it('starts recording when both legacy and AI consent pass', async () => {
    const { toggleRecordingImpl } =
      await import('@/modules/telepsicologia/server/toggle-recording');

    setupDbForStart({
      roomExists: true,
      legacyConsentSignedAt: new Date(),
      legacyConsentRevokedAt: null,
    });

    aiConsentResult = {
      ok: true,
      termId: randomUUID(),
      signedAt: new Date(),
      templateVersion: 1,
    };

    const client = fakeSupabaseClient(USER_ID);
    const result: ToggleRecordingResult = await toggleRecordingImpl(client, {
      room_id: ROOM_ID,
      action: 'start',
    });

    expect(result.ok).toBe(true);
    expect(mockStartRecording).toHaveBeenCalledOnce();
    // No transitional warning logged
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // (b) Legacy fails → recording blocked
  // -------------------------------------------------------------------------

  it('returns CONSENT_INVALID when legacy consent is missing', async () => {
    const { toggleRecordingImpl } =
      await import('@/modules/telepsicologia/server/toggle-recording');

    setupDbForStart({
      roomExists: true,
      legacyConsentSignedAt: null,
      legacyConsentRevokedAt: null,
    });

    // AI consent passes — but legacy fails, so result should still be CONSENT_INVALID
    aiConsentResult = {
      ok: true,
      termId: randomUUID(),
      signedAt: new Date(),
      templateVersion: 1,
    };

    const client = fakeSupabaseClient(USER_ID);
    const result: ToggleRecordingResult = await toggleRecordingImpl(client, {
      room_id: ROOM_ID,
      action: 'start',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CONSENT_INVALID');
    }
    expect(mockStartRecording).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // (c) AI term fails (legacy passes) → recording blocked + log emitted
  // -------------------------------------------------------------------------

  it('returns CONSENT_INVALID when AI consent is missing (legacy present) and logs transition warning', async () => {
    const { toggleRecordingImpl } =
      await import('@/modules/telepsicologia/server/toggle-recording');

    setupDbForStart({
      roomExists: true,
      legacyConsentSignedAt: new Date(),
      legacyConsentRevokedAt: null,
    });

    aiConsentResult = { ok: false, reason: 'never_signed' };

    const client = fakeSupabaseClient(USER_ID);
    const result: ToggleRecordingResult = await toggleRecordingImpl(client, {
      room_id: ROOM_ID,
      action: 'start',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CONSENT_INVALID');
    }
    expect(mockStartRecording).not.toHaveBeenCalled();

    // Verify the transitional log was emitted with the right event name.
    // userId and patientId are intentionally omitted from the log payload
    // to comply with LGPD data minimisation requirements.
    expect(mockLoggerWarn).toHaveBeenCalledOnce();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'legacy_present_but_ai_term_missing',
        aiReason: 'never_signed',
      }),
      expect.any(String),
    );
    // Confirm PII is NOT present in the log payload
    const logPayload = mockLoggerWarn.mock.calls[0]![0] as Record<string, unknown>;
    expect(logPayload).not.toHaveProperty('userId');
    expect(logPayload).not.toHaveProperty('patientId');
  });

  // -------------------------------------------------------------------------
  // (d) Both fail → recording blocked
  // -------------------------------------------------------------------------

  it('returns CONSENT_INVALID when both legacy and AI consent fail', async () => {
    const { toggleRecordingImpl } =
      await import('@/modules/telepsicologia/server/toggle-recording');

    setupDbForStart({
      roomExists: true,
      legacyConsentSignedAt: null,
      legacyConsentRevokedAt: null,
    });

    aiConsentResult = { ok: false, reason: 'never_signed' };

    const client = fakeSupabaseClient(USER_ID);
    const result: ToggleRecordingResult = await toggleRecordingImpl(client, {
      room_id: ROOM_ID,
      action: 'start',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CONSENT_INVALID');
    }
    expect(mockStartRecording).not.toHaveBeenCalled();
    // No transition log when legacy also fails (the log is specifically
    // for the "legacy present but AI missing" transitional state)
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });
});
