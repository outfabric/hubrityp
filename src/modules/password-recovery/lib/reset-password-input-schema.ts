import { z } from 'zod';

import { passwordPolicy } from '@/modules/registration/lib/password-validators';

/**
 * Validation schema for the "reset password" step — the user provides a
 * new password (subject to the strong-password policy) and confirms it.
 *
 * Reuses `passwordPolicy` from the registration module so the strength
 * requirements remain consistent across signup and password reset.
 *
 * Pure module — no I/O.
 */
const baseResetPasswordSchema = z.object({
  password: z
    .string({ message: 'Informe a nova senha.' })
    .refine((value) => passwordPolicy(value).ok, {
      message:
        'A senha deve ter pelo menos 10 caracteres e conter letra maiúscula, minúscula, número e caractere especial.',
    }),
  passwordConfirm: z.string({ message: 'Confirme a nova senha.' }),
});

export const resetPasswordInputSchema = baseResetPasswordSchema.refine(
  (data) => data.password === data.passwordConfirm,
  {
    message: 'As senhas não coincidem.',
    path: ['passwordConfirm'],
  },
);

export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;
