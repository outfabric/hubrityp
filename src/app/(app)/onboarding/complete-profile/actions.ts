'use server';

import { completeOAuthProfile as completeOAuthProfileImpl } from '@/modules/oauth';

export type { CompleteOAuthProfileResult } from '@/modules/oauth';

export async function completeOAuthProfile(formData: FormData) {
  return completeOAuthProfileImpl(formData);
}
