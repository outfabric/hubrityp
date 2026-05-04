import type { InferSelectModel } from 'drizzle-orm';

import type { profiles } from '@/shared/db/schema/auth/tables';

import { ProfileStatus } from './profile-status';

/**
 * Public-facing `Profile` shape used across the app surface (RSC pages,
 * Server Actions, the middleware, `getCurrentProfile`). Derived directly
 * from the Drizzle `profiles` table so the type stays in lockstep with the
 * schema — adding a column to `profiles` automatically propagates here
 * without a manual edit.
 *
 * `status` is kept as `string` by Drizzle (the column type is `text` with a
 * SQL CHECK constraint, not a Postgres enum), so we narrow it to
 * `ProfileStatus` at the type-system layer. Code that reads `profile.status`
 * therefore gets exhaustive `switch` checks for free.
 */
export type Profile = Omit<InferSelectModel<typeof profiles>, 'status'> & {
  status: ProfileStatus;
};

// Re-exported for ergonomics — consumers importing `Profile` typically also
// need the status enum to render or compare. The module barrel (section 6)
// will surface both from `@/modules/registration`.
export { ProfileStatus };
