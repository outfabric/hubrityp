'use server';

// Thin route shell for agenda page Server Actions.
//
// The actual implementations live in `src/modules/agenda/server/` (re-exported
// from `@/modules/agenda`). This file MUST stay thin and carry the
// `'use server'` directive — that is what marks it as a Server Action entry
// point for the Next.js compiler. Every export of a `'use server'` file MUST
// be an async function; types cannot be re-exported from here.

import type {
  CreateSessionResult,
  DeleteSessionResult,
  GetAgendaSettingsResult,
  GetSessionHistoryResult,
  ListLocationsResult,
  ListSessionsResult,
  MarkSessionDoneResult,
  UpdateSessionResult,
} from '@/modules/agenda';
import {
  createSessionImpl,
  deleteSessionImpl,
  getAgendaSettingsImpl,
  getSessionHistoryImpl,
  listLocationsImpl,
  listSessionsImpl,
  markSessionDoneImpl,
  updateSessionImpl,
} from '@/modules/agenda';
import type { ListPatientsResult } from '@/modules/patients';
import { listPatientsImpl } from '@/modules/patients';
import type {
  CancelRecurringSessionResult,
  CreateCoupleSessionResult,
  CreateLateRecordResult,
  CreateRecurringSessionResult,
  EditRecurringSessionResult,
} from '@/modules/sessions';
import {
  cancelRecurringSessionImpl,
  createCoupleSessionImpl,
  createLateRecordImpl,
  createRecurringSessionImpl,
  editRecurringSessionImpl,
} from '@/modules/sessions';
import { createServerClient } from '@/shared/supabase/server';

export async function listSessions(startDate: Date, endDate: Date): Promise<ListSessionsResult> {
  const supabase = await createServerClient();
  return listSessionsImpl(supabase, startDate, endDate);
}

export async function getAgendaSettings(): Promise<GetAgendaSettingsResult> {
  const supabase = await createServerClient();
  return getAgendaSettingsImpl(supabase);
}

export async function createSession(input: unknown): Promise<CreateSessionResult> {
  const supabase = await createServerClient();
  return createSessionImpl(supabase, input);
}

export async function updateSession(
  sessionId: string,
  input: unknown,
): Promise<UpdateSessionResult> {
  const supabase = await createServerClient();
  return updateSessionImpl(supabase, sessionId, input);
}

export async function listLocations(): Promise<ListLocationsResult> {
  const supabase = await createServerClient();
  return listLocationsImpl(supabase);
}

/**
 * Searches patients by name for the session form combobox.
 * Returns a lightweight list: only id and full_name.
 */
export async function searchPatients(
  query: string,
): Promise<{ ok: true; patients: Array<{ id: string; fullName: string }> } | { ok: false }> {
  const supabase = await createServerClient();
  const result: ListPatientsResult = await listPatientsImpl(supabase, {
    search: query,
    status: 'active',
    page: 1,
    pageSize: 20,
    sort: 'full_name',
    order: 'asc',
  });

  if (!result.ok) {
    return { ok: false };
  }

  return {
    ok: true,
    patients: result.patients.map((p) => ({ id: p.id, fullName: p.fullName })),
  };
}

export async function markSessionDone(sessionId: string): Promise<MarkSessionDoneResult> {
  const supabase = await createServerClient();
  return markSessionDoneImpl(supabase, sessionId);
}

export async function deleteSession(sessionId: string): Promise<DeleteSessionResult> {
  const supabase = await createServerClient();
  return deleteSessionImpl(supabase, sessionId);
}

export async function getSessionHistory(sessionId: string): Promise<GetSessionHistoryResult> {
  const supabase = await createServerClient();
  return getSessionHistoryImpl(supabase, sessionId);
}

// ---------------------------------------------------------------------------
// Recurring sessions
// ---------------------------------------------------------------------------

export async function createRecurringSession(
  input: unknown,
): Promise<CreateRecurringSessionResult> {
  const supabase = await createServerClient();
  return createRecurringSessionImpl(
    supabase,
    input as Parameters<typeof createRecurringSessionImpl>[1],
  );
}

export async function editRecurringSession(input: unknown): Promise<EditRecurringSessionResult> {
  const supabase = await createServerClient();
  return editRecurringSessionImpl(supabase, input);
}

export async function cancelRecurringSession(
  input: unknown,
): Promise<CancelRecurringSessionResult> {
  const supabase = await createServerClient();
  return cancelRecurringSessionImpl(supabase, input);
}

// ---------------------------------------------------------------------------
// Couple sessions
// ---------------------------------------------------------------------------

export async function createCoupleSession(input: unknown): Promise<CreateCoupleSessionResult> {
  const supabase = await createServerClient();
  return createCoupleSessionImpl(supabase, input as Parameters<typeof createCoupleSessionImpl>[1]);
}

// ---------------------------------------------------------------------------
// Late records
// ---------------------------------------------------------------------------

export async function createLateRecord(input: unknown): Promise<CreateLateRecordResult> {
  const supabase = await createServerClient();
  return createLateRecordImpl(supabase, input as Parameters<typeof createLateRecordImpl>[1]);
}
