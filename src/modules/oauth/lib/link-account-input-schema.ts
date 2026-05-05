import { z } from 'zod';

/**
 * Validation schema for the "link account" step during OAuth sign-in.
 *
 * When an OAuth login detects an existing account with the same email,
 * the user must confirm ownership by providing the existing account's
 * password. This schema validates that confirmation payload.
 *
 * Pure module — no I/O.
 */
export const linkAccountInputSchema = z.object({
  password: z.string({ message: 'Informe sua senha.' }).min(1, { message: 'Informe sua senha.' }),
  pendingUserId: z
    .string({ message: 'ID do usuário pendente é obrigatório.' })
    .uuid({ message: 'ID do usuário pendente inválido.' }),
});

export type LinkAccountInput = z.infer<typeof linkAccountInputSchema>;
