import { z } from 'zod';

/**
 * Validation schema for the "forgot password" step — the user provides
 * their email to receive a password-reset link.
 *
 * Reuses the same pt-BR copy and RFC-compliant email refinement used
 * throughout the product surface (login, signup).
 *
 * Pure module — no I/O.
 */
export const forgotPasswordInputSchema = z.object({
  email: z
    .string({ message: 'Informe seu e-mail.' })
    .min(1, { message: 'Informe seu e-mail.' })
    .email({ message: 'E-mail inválido.' }),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordInputSchema>;
