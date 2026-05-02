import { z } from 'zod';

/**
 * Single source of truth for login form validation.
 *
 * Used by both the React Hook Form resolver on the client (so the user
 * sees inline errors before submit) and the Server Action that performs
 * the credential exchange with Supabase Auth (so a tampered request is
 * rejected before reaching the auth backend).
 */
// Validation messages are written in pt-BR to match the rest of the product
// surface. They are user-facing on both the client (RHF inline errors) and,
// in principle, the server — though `signIn()` deliberately collapses any
// schema failure into the generic `invalid_credentials` so a probing
// attacker cannot tell "malformed email" from "wrong password" apart.
export const loginInputSchema = z.object({
  email: z
    .string({ message: 'Informe seu e-mail.' })
    .min(1, { message: 'Informe seu e-mail.' })
    .email({ message: 'E-mail inválido.' }),
  password: z
    .string({ message: 'Informe sua senha.' })
    .min(8, { message: 'A senha deve ter pelo menos 8 caracteres.' }),
});

export type LoginInput = z.infer<typeof loginInputSchema>;
