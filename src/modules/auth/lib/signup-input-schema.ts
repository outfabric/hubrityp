import { z } from 'zod';

// We intentionally import the pure CRP validators from the `lib/` path rather
// than from the `@/modules/crp-validation` barrel: the barrel re-exports
// server-only actions (`approveCrpValidation`, `rejectCrpValidation`, both
// carrying `import 'server-only'`), and the signup form Client Component
// transitively pulls THIS module — going through the barrel would drag the
// server-only chain into the browser bundle and the RSC boundary checker
// would correctly refuse the build. The barrel comment in
// `src/modules/crp-validation/index.ts` documents the same trap.
import { crpNumberSchema, crpUfSchema } from '@/modules/crp-validation/lib/crp-format';

/**
 * Single source of truth for signup form validation.
 *
 * Used by both the React Hook Form resolver on the client (so the user sees
 * inline errors before submit) and the `signUp` Server Action that performs
 * the credential exchange + DB insert (so a tampered request is rejected
 * before any side effect).
 *
 * Validation messages are written in pt-BR — they are user-facing on both
 * the client and the server (the action surfaces them via `fieldErrors`).
 *
 * The schema is the source of truth for PRD 01 §5.1 cadastro fields:
 *   • fullName: trimmed, 3..120 chars
 *   • email: RFC-compliant; lower-cased before persistence (transform here)
 *   • password: min 10 chars + 4 character classes (RF-01.04). Each missing
 *     class produces a separate error message — the form lists every
 *     unsatisfied requirement at once instead of revealing them one at a time.
 *   • passwordConfirm: equals `password` (object-level refinement)
 *   • crpNumber/crpUf: delegated to `@/modules/crp-validation` schemas
 *   • acceptedTerms / acceptedPrivacy / acceptedSensitiveData: literal `true`
 */

// Password complexity: built with `superRefine` (rather than chained
// `.regex`) so we can emit ONE error per missing class. PRD-01 RF-01.04 calls
// for every requirement to be visible to the user simultaneously.
const SPECIAL_CHARS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

// Escape regex metacharacters in the special-char set so the test pattern
// matches the literal characters listed above. `[` `]` `\` etc. would
// otherwise change the class semantics.
const SPECIAL_CHAR_PATTERN = new RegExp(
  `[${SPECIAL_CHARS.replace(/[\\^$.*+?()[\]{}|\-]/g, '\\$&')}]`,
);

const passwordSchema = z.string({ message: 'Informe sua senha.' }).superRefine((value, ctx) => {
  if (value.length < 10) {
    ctx.addIssue({
      code: 'custom',
      message: 'A senha deve ter pelo menos 10 caracteres.',
    });
  }
  if (!/[A-Z]/.test(value)) {
    ctx.addIssue({
      code: 'custom',
      message: 'A senha deve conter ao menos uma letra maiúscula.',
    });
  }
  if (!/[a-z]/.test(value)) {
    ctx.addIssue({
      code: 'custom',
      message: 'A senha deve conter ao menos uma letra minúscula.',
    });
  }
  if (!/\d/.test(value)) {
    ctx.addIssue({ code: 'custom', message: 'A senha deve conter ao menos um número.' });
  }
  if (!SPECIAL_CHAR_PATTERN.test(value)) {
    ctx.addIssue({
      code: 'custom',
      message: 'A senha deve conter ao menos um caractere especial.',
    });
  }
});

export const signupInputSchema = z
  .object({
    fullName: z
      .string({ message: 'Informe seu nome completo.' })
      .trim()
      .min(3, { message: 'Nome muito curto.' })
      .max(120, { message: 'Nome muito longo.' }),
    // Lower-case the email at the schema boundary so every consumer
    // (signup action, factories, tests) sees the canonical form. The
    // PRD requires emails to be persisted lower-case to keep lookups
    // case-insensitive without `LOWER(...)` everywhere.
    email: z
      .string({ message: 'Informe seu e-mail.' })
      .min(1, { message: 'Informe seu e-mail.' })
      .email({ message: 'E-mail inválido.' })
      .transform((value) => value.toLowerCase()),
    password: passwordSchema,
    passwordConfirm: z.string({ message: 'Confirme sua senha.' }),
    crpNumber: crpNumberSchema,
    crpUf: crpUfSchema,
    acceptedTerms: z.literal(true, {
      message: 'Você precisa aceitar os Termos de Uso para continuar.',
    }),
    acceptedPrivacy: z.literal(true, {
      message: 'Você precisa aceitar a Política de Privacidade para continuar.',
    }),
    acceptedSensitiveData: z.literal(true, {
      message: 'Você precisa aceitar o tratamento de dados sensíveis para continuar.',
    }),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: 'As senhas não conferem.',
    path: ['passwordConfirm'],
  });

export type SignupInput = z.infer<typeof signupInputSchema>;
