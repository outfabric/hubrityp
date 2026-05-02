import { z } from 'zod';

/**
 * Single source of truth for login form validation.
 *
 * Used by both the React Hook Form resolver on the client (so the user
 * sees inline errors before submit) and the Server Action that performs
 * the credential exchange with Supabase Auth (so a tampered request is
 * rejected before reaching the auth backend).
 */
export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export type LoginInput = z.infer<typeof loginInputSchema>;
