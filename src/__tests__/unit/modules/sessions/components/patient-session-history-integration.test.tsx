// @vitest-environment jsdom

/**
 * Wired-tab integration test (task 9.3).
 *
 * Renders `PatientTabs` with the real `PatientSessionHistory` plugged into the
 * `sessionsContent` slot — exactly as the patient detail page wires it. The
 * Server Action is mocked so the component's own `QueryClientProvider` island
 * drives the real TanStack Query flow against deterministic data.
 *
 * Asserts:
 *   - opening the "Histórico de sessões" tab renders the history (summary +
 *     list), not the old "Em breve" placeholder;
 *   - the empty state renders for a patient with no sessions;
 *   - the "Financeiro" tab still shows the "Em breve" placeholder.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PatientTabs } from '@/modules/patients/components/patient-tabs';
import { PatientSessionHistory } from '@/modules/sessions';
import type {
  PatientId,
  SessionHistoryItem,
  SessionHistoryResult,
} from '@/modules/sessions/lib/session-history-schema';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Render a plain <a> so PatientTabs links resolve without the Next.js router.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The Server Action that `PatientSessionHistory` calls. Each test sets the
// resolved value to drive the populated vs. empty path.
const getPatientSessionHistory = vi.fn<(input: unknown) => Promise<SessionHistoryResult>>();
vi.mock('@/app/(app)/pacientes/[id]/actions', () => ({
  getPatientSessionHistory: (input: unknown) => getPatientSessionHistory(input),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';
const PATIENT_NAME = 'Maria Teste';

function makeSession(overrides: Partial<SessionHistoryItem> = {}): SessionHistoryItem {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    patientId: PATIENT_ID as PatientId,
    status: 'done',
    startAt: '2025-12-15T14:30:00.000Z',
    endAt: '2025-12-15T15:20:00.000Z',
    durationMinutes: 50,
    modality: 'online',
    locationName: null,
    amount: null,
    isCouple: false,
    isLateRecord: false,
    rescheduledFromDate: null,
    evolutionId: null,
    evolutionFinalizedAt: null,
    cancellationReason: null,
    cancelledBy: null,
    cancellationNotice: null,
    chargeCancellation: null,
    ...overrides,
  };
}

function populatedPage(): SessionHistoryResult {
  return {
    ok: true,
    summary: {
      doneTotal: 4,
      attendanceRate: 100,
      doneWithoutEvolution: 1,
      lastDoneAt: '2025-12-15T15:20:00.000Z',
    },
    sessions: [makeSession()],
    nextCursor: null,
  };
}

function emptyPage(): SessionHistoryResult {
  return { ok: true, sessions: [], nextCursor: null };
}

function renderWiredTabs() {
  return render(
    <PatientTabs
      patientId={PATIENT_ID}
      overviewContent={<div>overview</div>}
      sessionsContent={<PatientSessionHistory patientId={PATIENT_ID} patientName={PATIENT_NAME} />}
      anamnesisContent={<div>anamnesis</div>}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PatientTabs wired with PatientSessionHistory (task 9.3)', () => {
  beforeEach(() => {
    getPatientSessionHistory.mockReset();
  });

  it('renders the session history (summary + list) on the sessions tab, not the placeholder', async () => {
    getPatientSessionHistory.mockResolvedValue(populatedPage());
    const user = userEvent.setup();
    renderWiredTabs();

    await user.click(screen.getByTestId('patient-tab-sessions'));

    const panel = screen.getByTestId('patient-tab-content-sessions');

    // The real history rendered: summary strip + the session list.
    await waitFor(() => {
      expect(within(panel).getByTestId('patient-session-history')).toBeInTheDocument();
    });
    expect(within(panel).getByTestId('session-history-list')).toBeInTheDocument();

    // The old placeholder is gone from the sessions tab.
    expect(screen.queryByTestId('patient-tab-placeholder-sessions')).not.toBeInTheDocument();
  });

  it('renders the empty state for a patient with no sessions', async () => {
    getPatientSessionHistory.mockResolvedValue(emptyPage());
    const user = userEvent.setup();
    renderWiredTabs();

    await user.click(screen.getByTestId('patient-tab-sessions'));

    const panel = screen.getByTestId('patient-tab-content-sessions');
    await waitFor(() => {
      expect(within(panel).getByTestId('session-history-empty')).toBeInTheDocument();
    });
    expect(within(panel).queryByTestId('patient-session-history')).not.toBeInTheDocument();
  });

  it('still shows the "Em breve" placeholder on the Financeiro tab', async () => {
    getPatientSessionHistory.mockResolvedValue(emptyPage());
    const user = userEvent.setup();
    renderWiredTabs();

    await user.click(screen.getByTestId('patient-tab-financial'));

    const panel = screen.getByTestId('patient-tab-content-financial');
    expect(panel).toBeVisible();
    expect(within(panel).getByTestId('patient-tab-placeholder-financial')).toHaveTextContent(
      'Em breve',
    );
  });
});
