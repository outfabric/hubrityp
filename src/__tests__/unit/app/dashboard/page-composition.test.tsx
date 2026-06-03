import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HasAnyDataResult, PendenciasResult, TodaySessionsResult } from '@/modules/dashboard';
import type * as RegistrationModule from '@/modules/registration';
import { ProfileStatus } from '@/modules/registration';

// ---------------------------------------------------------------------------
// Mocks
//
// DashboardPage is an async Server Component. We render its resolved tree in
// jsdom by awaiting the default export and passing the result to `render`.
// The collaborators it imports — the Supabase client, the registration profile
// read, the four dashboard helpers, and the section components — are all mocked
// so the test exercises ONLY the page's composition logic: the profile gate,
// the empty-state branch, and the order of the four sections.
// ---------------------------------------------------------------------------

const { mockRedirect, mockGetCurrentProfile, mockStampFirstAccess } = vi.hoisted(() => ({
  // Next's redirect() throws to halt rendering — we mirror that so the page's
  // control flow stops exactly where it would in production.
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  mockGetCurrentProfile: vi.fn(),
  mockStampFirstAccess: vi.fn(),
}));

const mockGetTodaySessions = vi.fn();
const mockGetPendencias = vi.fn();
const mockHasAnyData = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}));

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn((): Promise<unknown> => Promise.resolve({})),
}));

vi.mock('@/modules/registration', async () => {
  const actual = await vi.importActual<typeof RegistrationModule>('@/modules/registration');
  return {
    // Keep the real ProfileStatus enum so the page's `!== Active` comparison is
    // exercised against the genuine values, not a stubbed constant.
    ProfileStatus: actual.ProfileStatus,
    getCurrentProfile: (...args: unknown[]) => mockGetCurrentProfile(...args) as unknown,
  };
});

// Replace the dashboard barrel: the data helpers are spies and the section
// components / slots are lightweight stand-ins that emit a stable testid so we
// can assert presence and DOM order without booting the real components.
vi.mock('@/modules/dashboard', () => ({
  getTodaySessions: (...args: unknown[]) => mockGetTodaySessions(...args) as unknown,
  getPendencias: (...args: unknown[]) => mockGetPendencias(...args) as unknown,
  hasAnyData: (...args: unknown[]) => mockHasAnyData(...args) as unknown,
  stampFirstAccess: (...args: unknown[]) => mockStampFirstAccess(...args) as unknown,
  SectionToday: () => <div data-testid="mock-section-today" />,
  SectionPendencias: () => <div data-testid="mock-section-pendencias" />,
  SectionWeeklySkeleton: () => <div data-testid="mock-section-weekly-skeleton" />,
  WeeklySummarySlot: () => <div data-testid="mock-weekly-slot" />,
  FirstStepsSlot: () => <div data-testid="mock-first-steps" />,
  DashboardSecondary: ({ weekly }: { weekly: React.ReactNode }) => (
    <div data-testid="mock-section-secondary">{weekly}</div>
  ),
}));

// Import AFTER the mocks are registered so the page picks up the stubs.
const { default: DashboardPage } = await import('@/app/(app)/dashboard/page');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function activeProfile(overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'Dra. Helena',
    status: ProfileStatus.Active,
    ...overrides,
  };
}

const TODAY_OK: TodaySessionsResult = { ok: true, next: null, sessions: [] };
const PENDENCIAS_OK: PendenciasResult = {
  ok: true,
  overdueEvolutionsCount: 0,
  overdueEvolutionsHref: '/agenda?filtro=sem-evolucao',
  patientsMissingConsentCount: 0,
  patientsMissingConsentHref: '/pacientes?filtro=sem-consentimento',
  aiNotesAwaitingReviewCount: 0,
  aiNotesAwaitingReviewHref: '/configuracoes/ia/transcricoes?status=ready',
};

function hasData(value: boolean): HasAnyDataResult {
  return { ok: true, hasAnyData: value };
}

async function renderPage() {
  // `stampFirstAccess` is fire-and-forget (not awaited by the page); resolve it
  // so the floating promise settles cleanly and never rejects under the test.
  mockStampFirstAccess.mockResolvedValue({ ok: true, stamped: false });
  const ui = await DashboardPage();
  render(ui);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardPage — composition', () => {
  it('renders the four sections in order when the user has data', async () => {
    mockGetCurrentProfile.mockResolvedValue(activeProfile());
    mockGetTodaySessions.mockResolvedValue(TODAY_OK);
    mockGetPendencias.mockResolvedValue(PENDENCIAS_OK);
    mockHasAnyData.mockResolvedValue(hasData(true));

    await renderPage();

    // All four operational surfaces present; the first-steps slot is NOT.
    const today = screen.getByTestId('mock-section-today');
    const pendencias = screen.getByTestId('mock-section-pendencias');
    const secondary = screen.getByTestId('mock-section-secondary');
    expect(today).toBeInTheDocument();
    expect(pendencias).toBeInTheDocument();
    expect(secondary).toBeInTheDocument();
    // Resumo (the weekly slot) lives inside the secondary section + Suspense.
    expect(screen.getByTestId('mock-weekly-slot')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-first-steps')).not.toBeInTheDocument();

    // Order: Hoje → Pendências → (Resumo + Ações secondary block).
    const order = today.compareDocumentPosition(pendencias);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const order2 = pendencias.compareDocumentPosition(secondary);
    expect(order2 & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('greets the user by name and stamps first access (fire-and-forget)', async () => {
    mockGetCurrentProfile.mockResolvedValue(activeProfile({ fullName: 'Dra. Helena' }));
    mockGetTodaySessions.mockResolvedValue(TODAY_OK);
    mockGetPendencias.mockResolvedValue(PENDENCIAS_OK);
    mockHasAnyData.mockResolvedValue(hasData(true));

    await renderPage();

    expect(screen.getByTestId('dashboard-greeting')).toHaveTextContent('Olá, Dra. Helena');
    expect(mockStampFirstAccess).toHaveBeenCalledTimes(1);
  });

  it('renders the first-steps slot (and no sections) when the user has zero data', async () => {
    mockGetCurrentProfile.mockResolvedValue(activeProfile());
    mockGetTodaySessions.mockResolvedValue(TODAY_OK);
    mockGetPendencias.mockResolvedValue(PENDENCIAS_OK);
    mockHasAnyData.mockResolvedValue(hasData(false));

    await renderPage();

    expect(screen.getByTestId('mock-first-steps')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-section-today')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-section-pendencias')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-section-secondary')).not.toBeInTheDocument();
  });

  it('redirects to /onboarding/pending when the profile is not active', async () => {
    mockGetCurrentProfile.mockResolvedValue(
      activeProfile({ status: ProfileStatus.PendingVerification }),
    );

    await expect(DashboardPage()).rejects.toThrow('NEXT_REDIRECT:/onboarding/pending');
    expect(mockRedirect).toHaveBeenCalledWith('/onboarding/pending');
    // The page must not have reached the data layer for a gated profile.
    expect(mockGetTodaySessions).not.toHaveBeenCalled();
  });

  it('redirects to /login when there is no profile', async () => {
    mockGetCurrentProfile.mockResolvedValue(null);

    await expect(DashboardPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });

  it('redirects to /login (defense in depth) when a data helper reports an invalid session', async () => {
    mockGetCurrentProfile.mockResolvedValue(activeProfile());
    mockStampFirstAccess.mockResolvedValue({ ok: true, stamped: false });
    mockGetTodaySessions.mockResolvedValue({ ok: false, code: 'UNAUTHORIZED' });
    mockGetPendencias.mockResolvedValue(PENDENCIAS_OK);
    mockHasAnyData.mockResolvedValue(hasData(true));

    await expect(DashboardPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });
});
