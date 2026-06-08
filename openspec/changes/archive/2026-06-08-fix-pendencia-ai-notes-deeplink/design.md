# Design — fix-pendencia-ai-notes-deeplink

## Context

Three pieces of existing code are involved (all verified):

- `src/modules/dashboard/server/get-pendencias.ts` — emits the static `AI_NOTES_AWAITING_REVIEW_HREF` constant. Currently `'/configuracoes/ia/transcricoes?status=ready'` (non-existent route).
- `src/app/(app)/dashboard/transcricoes/page.tsx` — a Server Component. `default export TranscricoesPage()` takes **no** `searchParams`; an inner `TranscriptionListServer()` calls `listTranscriptionsForReviewImpl(supabase)` inside `<Suspense>` and renders `<TranscriptionsTabs buckets={...} />` (or `<TranscriptionsEmptyState/>` when all buckets are empty).
- `src/modules/ai-transcription/components/transcriptions-tabs.tsx` — `'use client'`. Renders shadcn `<Tabs defaultValue="pending">` with tabs `pending` / `reviewed` / `failed`. `defaultValue` is hardcoded.

The buckets already encode the business rule: the dashboard counts AI notes with `status = 'ready'`; on this page those rows are exactly the **`pending`** bucket (`status='ready' AND saved_to_prontuario=false`). So the URL term `status=ready` (data-status vocabulary, matching `get-pendencias`) maps to the UI tab `pending`.

The data query and its owner-scoping (`listTranscriptionsForReviewImpl`) are **not touched** — this change is navigation-only.

## Goals / Non-goals

**Goals**
- The dashboard AI-notes "Ver" link lands on a real route with the pending queue pre-selected on first server paint.
- A reusable, server-validated **closed allowlist** translating the `status` searchParam into the initial tab, degrading gracefully.

**Non-goals**
- No new tabs, no change to bucket definitions, no change to ordering, no data-model change.
- No removable filter chip (tab labels are the visible indicator per RF-12.17).
- No change to the other two PRD-12 destinations (separate changes).

## Decisions

### D1 — Allowlist parser as a pure lib function

Add `src/modules/ai-transcription/lib/transcription-list-tab.ts`:

```ts
export const TRANSCRIPTION_TABS = ['pending', 'reviewed', 'failed'] as const;
export type TranscriptionTab = (typeof TRANSCRIPTION_TABS)[number];

// Closed allowlist: maps the URL `status` term (data-status vocabulary, the same
// values get-pendencias speaks) to the initial UI tab. MVP allows only `ready`.
const STATUS_TO_TAB: Readonly<Record<string, TranscriptionTab>> = { ready: 'pending' };

export const DEFAULT_TRANSCRIPTION_TAB: TranscriptionTab = 'pending';

/** Resolve the initial tab from a raw searchParam. Unknown/empty/array → default. */
export function resolveInitialTabFromStatus(
  raw: string | string[] | undefined,
): TranscriptionTab {
  if (typeof raw !== 'string') return DEFAULT_TRANSCRIPTION_TAB; // undefined or array
  return STATUS_TO_TAB[raw] ?? DEFAULT_TRANSCRIPTION_TAB;
}
```

Re-export both `resolveInitialTabFromStatus` and the `TranscriptionTab` type from the module barrel `src/modules/ai-transcription/index.ts`.

- **Why pure + server-side:** RNF-12.05 requires allowlist validation on the server against filter injection. A pure function is trivially unit-tested (each scenario = one case) and reused by both the page and tests. No exception is ever thrown — unknown input silently returns the default (RF-12.16 / RN-12.05).
- **Why `ready → pending` (not identity):** the URL speaks data-status (`ready`, matching the count predicate and the dashboard contract); the UI speaks tab names (`pending`). Keeping the URL vocabulary aligned with `get-pendencias` makes the deep-link contract self-consistent. The map is the single seam where future statuses could be allowed.

### D2 — Resolve `searchParams` in the page, thread `initialTab` down

`TranscricoesPage` becomes `async` and accepts Next 16's `searchParams` promise:

```ts
export default async function TranscricoesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { status } = await searchParams;
  const initialTab = resolveInitialTabFromStatus(status);
  // ...render, passing initialTab into <TranscriptionListServer initialTab={initialTab} />
}
```

`TranscriptionListServer` forwards `initialTab` to `<TranscriptionsTabs initialTab={initialTab} buckets={...} />`.

- **Why resolve in the page, not the inner Suspense child:** awaiting `searchParams` is effectively free and lets the `<Suspense>` boundary keep streaming the DB fetch. `initialTab` is a tiny serializable scalar passed across the server→client boundary — no waterfall (RNF-12.02).
- **First paint (RNF-12.01):** because `defaultValue` is computed on the server and rendered in the initial HTML, the correct tab is active on first paint — no client-side flip/flash.

### D3 — `TranscriptionsTabs` accepts `initialTab`, defaults to `pending`

```ts
interface TranscriptionsTabsProps {
  buckets: TranscriptionListBuckets;
  initialTab?: TranscriptionTab; // default 'pending'
}
// <Tabs defaultValue={initialTab ?? 'pending'} ...>
```

- Kept **uncontrolled** (`defaultValue`, not `value`): the user can still click other tabs freely; we only seed the first render. Backward compatible — existing callers/tests that omit `initialTab` keep the `pending` default. All `data-testid`s unchanged.

### D4 — Constant fix

In `get-pendencias.ts`, single line:
`const AI_NOTES_AWAITING_REVIEW_HREF = '/dashboard/transcricoes?status=ready';`

No other logic in that file changes; the count predicate and owner-scoping stay as-is (RN-12.03).

## Security / LGPD

- The href is a static server-owned string with an allowlisted scalar — no PII, no client input interpolated (PRD 12, §11).
- Allowlist runs server-side; an injected `?status=<anything>` cannot widen the query or the owner scope (RN-12.02 / RNF-12.05). The underlying `listTranscriptionsForReviewImpl` remains owner-scoped + RLS-backed.
- No logging change; no token/PII enters logs.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| In MVP `ready → pending` equals the existing default, making the wiring look like a no-op | The value is the **fixed route** (D4) + the **server-validated contract/seam** (D1). Tests assert the parser table and the corrected href, not just visual tab state. |
| Making the page `async` / adding `searchParams` regresses streaming | `searchParams` await is negligible; `<Suspense>` around the DB fetch is preserved. |
| Empty-state branch ignores `initialTab` | Intentional — with zero items there is no tab UI; the empty state is unaffected (RF-12.19 for this destination is the existing "Nenhuma transcrição ainda"). |

## Test strategy

- **Unit** (`src/__tests__/unit/modules/ai-transcription/lib/transcription-list-tab.test.ts`): `resolveInitialTabFromStatus` — `'ready'→'pending'`, `undefined→'pending'`, `'xyz'→'pending'`, `''→'pending'`, `['ready','reviewed']→'pending'`. Plus a unit/integration assertion that `getPendencias` returns `aiNotesAwaitingReviewHref === '/dashboard/transcricoes?status=ready'` (extend the existing `get-pendencias` test).
- **Integration**: in the existing `get-pendencias` integration suite, assert the corrected href against a real seeded user (parity with the count). (Server-Component RSC rendering is covered by E2E rather than RTL to avoid brittle RSC harnessing.)
- **E2E (seeded)** `src/__tests__/e2e/seeded/ai-transcription/`:
  - Dashboard → click the AI-notes "Ver" link → URL is `/dashboard/transcricoes?status=ready` and `tab-pending` is the active tab (`panel-pending` visible) on load.
  - **Negative-auth:** anonymous GET of `/dashboard/transcricoes?status=ready` → redirected to `/login` (the owed gating test; preserves the parameter is desirable, not required).
  - Degradation: load `/dashboard/transcricoes?status=xyz` (authenticated, with items) → page renders, default Pendentes tab, no error.

## Rollout

Pure forward fix — no migration, no flag, reversible by reverting the constant + page/component props. Sibling PRD-12 changes reuse the D1 allowlist pattern (each owns its own destination's parser).
