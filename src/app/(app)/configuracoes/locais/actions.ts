'use server';

// Thin route shell for location-level Server Actions.
//
// The actual implementations live in `src/modules/agenda/server/` (re-exported
// from `@/modules/agenda`). This file MUST stay thin and carry the
// `'use server'` directive -- that is what marks it as a Server Action entry
// point for the Next.js compiler. Every export of a `'use server'` file MUST
// be an async function; types cannot be re-exported from here.

import type {
  CreateLocationResult,
  DeleteLocationResult,
  ListLocationsResult,
  SetLocationDefaultResult,
  UpdateLocationResult,
} from '@/modules/agenda';
import {
  createLocationImpl,
  deleteLocationImpl,
  listLocationsImpl,
  setLocationDefaultImpl,
  updateLocationImpl,
} from '@/modules/agenda';
import { createServerClient } from '@/shared/supabase/server';

export async function listLocations(): Promise<ListLocationsResult> {
  const supabase = await createServerClient();
  return listLocationsImpl(supabase);
}

export async function createLocation(input: unknown): Promise<CreateLocationResult> {
  const supabase = await createServerClient();
  return createLocationImpl(supabase, input);
}

export async function updateLocation(
  locationId: string,
  input: unknown,
): Promise<UpdateLocationResult> {
  const supabase = await createServerClient();
  return updateLocationImpl(supabase, locationId, input);
}

export async function deleteLocation(locationId: string): Promise<DeleteLocationResult> {
  const supabase = await createServerClient();
  return deleteLocationImpl(supabase, locationId);
}

export async function setLocationDefault(locationId: string): Promise<SetLocationDefaultResult> {
  const supabase = await createServerClient();
  return setLocationDefaultImpl(supabase, locationId);
}
