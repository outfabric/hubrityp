'use server';

import { linkOAuthIdentity as linkOAuthIdentityImpl } from '@/modules/oauth';

export type { LinkOAuthIdentityResult } from '@/modules/oauth';

export async function linkOAuthIdentity(formData: FormData) {
  return linkOAuthIdentityImpl(formData);
}
