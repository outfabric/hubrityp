import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted before the component import.
//
// `mockPresence` drives the (mocked) `useVideoRoomPresence` hook so each test
// controls whether the patient is "present" without standing up a real
// Realtime channel. The presence timing mechanics (heartbeat refresh, departure
// clear, TTL auto-clear) are covered in the hook's own unit test; here we only
// assert how the badge gate reacts to the resulting boolean + the local
// post-admit latch.
// ---------------------------------------------------------------------------

let mockPresence = false;

vi.mock('@/modules/telepsicologia/hooks/use-video-room-presence', () => ({
  useVideoRoomPresence: (): boolean => mockPresence,
}));

// Stream SDK — only `SpeakerLayout` and `useCall` are used by InCallView.
vi.mock('@stream-io/video-react-sdk', () => ({
  SpeakerLayout: () => <div data-testid="mock-speaker-layout" />,
  useCall: () => ({ on: vi.fn(() => vi.fn()) }),
}));

// Heavy children replaced with inert stubs.
vi.mock('@/modules/telepsicologia/components/call-control-bar', () => ({
  CallControlBar: () => <div data-testid="mock-call-control-bar" />,
}));
vi.mock('@/modules/telepsicologia/components/chat-drawer', () => ({
  ChatDrawer: () => <div data-testid="mock-chat-drawer" />,
}));
vi.mock('@/modules/telepsicologia/components/connection-quality-indicator', () => ({
  ConnectionQualityIndicator: () => <div data-testid="mock-connection-quality" />,
}));
vi.mock('@/modules/telepsicologia/components/elapsed-time', () => ({
  ElapsedTime: () => <div data-testid="mock-elapsed-time" />,
}));
vi.mock('@/modules/telepsicologia/components/prontuario-call-drawer', () => ({
  ProntuarioCallDrawer: () => <div data-testid="mock-prontuario-drawer" />,
}));
vi.mock('@/modules/telepsicologia/components/screen-share-indicator', () => ({
  ScreenShareIndicator: () => <div data-testid="mock-screen-share" />,
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { InCallView } from '@/modules/telepsicologia/components/in-call-view';
import type { VideoRoom } from '@/shared/db/schema/telepsicologia/tables';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

function makeRoom(status: VideoRoom['status']): VideoRoom {
  return { id: ROOM_ID, status, patientLastSeenAt: null } as VideoRoom;
}

function renderView(room: VideoRoom, onAdmitPatient = vi.fn().mockResolvedValue({ ok: true })) {
  return render(
    <InCallView
      patient={{ id: 'p1', fullName: 'Maria' }}
      room={room}
      onEndSession={vi.fn().mockResolvedValue({ ok: true })}
      onAdmitPatient={onAdmitPatient}
      currentUser={{ id: USER_ID, name: 'Dr. Teste' }}
      recentEvolutions={[]}
      onCreateEvolution={vi.fn().mockResolvedValue({ ok: true })}
      onUpdateEvolution={vi.fn().mockResolvedValue({ ok: true })}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InCallView — waiting-room badge gate', () => {
  beforeEach(() => {
    mockPresence = false;
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('hides the badge when no/stale heartbeat, even while status is pending', () => {
    mockPresence = false;
    renderView(makeRoom('pending'));

    expect(screen.queryByTestId('waiting-room-badge')).not.toBeInTheDocument();
  });

  it('shows the badge when the heartbeat is fresh and status is pending', () => {
    mockPresence = true;
    renderView(makeRoom('pending'));

    expect(screen.getByTestId('waiting-room-badge')).toBeInTheDocument();
    expect(screen.getByTestId('admit-patient-button')).toBeInTheDocument();
  });

  it('hides the badge when the patient is present but status is not pending', () => {
    mockPresence = true;
    renderView(makeRoom('active'));

    expect(screen.queryByTestId('waiting-room-badge')).not.toBeInTheDocument();
  });

  it('clears the badge immediately when a departure flips presence to false', () => {
    mockPresence = true;
    const { rerender } = renderView(makeRoom('pending'));
    expect(screen.getByTestId('waiting-room-badge')).toBeInTheDocument();

    // A departure broadcast (null heartbeat) makes the hook report absent.
    mockPresence = false;
    rerender(
      <InCallView
        patient={{ id: 'p1', fullName: 'Maria' }}
        room={makeRoom('pending')}
        onEndSession={vi.fn().mockResolvedValue({ ok: true })}
        onAdmitPatient={vi.fn().mockResolvedValue({ ok: true })}
        currentUser={{ id: USER_ID, name: 'Dr. Teste' }}
        recentEvolutions={[]}
        onCreateEvolution={vi.fn().mockResolvedValue({ ok: true })}
        onUpdateEvolution={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );

    expect(screen.queryByTestId('waiting-room-badge')).not.toBeInTheDocument();
  });

  it('auto-clears the badge when freshness lapses (presence becomes false after the TTL)', () => {
    // The TTL re-evaluation lives in the hook (covered there). At the badge
    // layer, the lapse surfaces as `isPatientPresent === false`.
    mockPresence = true;
    const { rerender } = renderView(makeRoom('pending'));
    expect(screen.getByTestId('waiting-room-badge')).toBeInTheDocument();

    mockPresence = false;
    rerender(
      <InCallView
        patient={{ id: 'p1', fullName: 'Maria' }}
        room={makeRoom('pending')}
        onEndSession={vi.fn().mockResolvedValue({ ok: true })}
        onAdmitPatient={vi.fn().mockResolvedValue({ ok: true })}
        currentUser={{ id: USER_ID, name: 'Dr. Teste' }}
        recentEvolutions={[]}
        onCreateEvolution={vi.fn().mockResolvedValue({ ok: true })}
        onUpdateEvolution={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );

    expect(screen.queryByTestId('waiting-room-badge')).not.toBeInTheDocument();
  });

  it('clears the badge immediately after a successful admit, without a status prop change', async () => {
    const user = userEvent.setup();
    mockPresence = true;
    const onAdmitPatient = vi.fn().mockResolvedValue({ ok: true });
    // `room.status` stays 'pending' the whole time — the local `admitted` latch
    // is what hides the badge.
    renderView(makeRoom('pending'), onAdmitPatient);

    expect(screen.getByTestId('waiting-room-badge')).toBeInTheDocument();

    await user.click(screen.getByTestId('admit-patient-button'));

    await waitFor(() => {
      expect(screen.queryByTestId('waiting-room-badge')).not.toBeInTheDocument();
    });
    expect(onAdmitPatient).toHaveBeenCalledWith(ROOM_ID);
  });

  it('keeps the badge shown after a failed admit', async () => {
    const user = userEvent.setup();
    mockPresence = true;
    const onAdmitPatient = vi.fn().mockResolvedValue({ ok: false });
    renderView(makeRoom('pending'), onAdmitPatient);

    await user.click(screen.getByTestId('admit-patient-button'));

    // Admit failed → no latch → badge remains while the patient is present.
    await waitFor(() => {
      expect(screen.getByTestId('admit-patient-button')).not.toBeDisabled();
    });
    expect(screen.getByTestId('waiting-room-badge')).toBeInTheDocument();
  });
});
