import { z } from 'zod';

import { isCrpRegionalConsistentWithUf, isValidCrpFormat } from './crp-validators';
import { passwordPolicy } from './password-validators';
import { UF_SET, type UfCode } from './uf-table';

/**
 * Single source of truth for signup form validation.
 *
 * Used by both:
 *   - the React Hook Form resolver on the client, so the user sees inline
 *     errors before submit;
 *   - the `signUp` Server Action, so a tampered request is rejected before
 *     reaching Supabase Auth.
 *
 * Composition over duplication: every business rule (password strength,
 * CRP format, regional/UF consistency, UF set membership) is delegated to
 * the pure validators in this folder. This file is the assembly layer.
 *
 * Error messages are written in pt-BR to match the rest of the product
 * surface — the spec asserts pt-BR explicitly for the regional-mismatch
 * scenario.
 */
export const signupInputSchema = z
  .object({
    fullName: z
      .string({ message: 'Informe seu nome completo.' })
      .trim()
      .min(3, { message: 'O nome deve ter pelo menos 3 caracteres.' })
      .max(120, { message: 'O nome deve ter no máximo 120 caracteres.' }),
    email: z
      .string({ message: 'Informe seu e-mail.' })
      .min(1, { message: 'Informe seu e-mail.' })
      .email({ message: 'E-mail inválido.' }),
    password: z
      .string({ message: 'Informe uma senha.' })
      // The strong-password policy is the single source of truth — we run
      // it once and rely on its boolean. Per-rule UI feedback consumes the
      // `missing` array directly via `passwordPolicy(value)` in the form
      // component.
      .refine((value) => passwordPolicy(value).ok, {
        message:
          'A senha deve ter pelo menos 10 caracteres e conter letra maiúscula, minúscula, número e caractere especial.',
      }),
    passwordConfirm: z.string({ message: 'Confirme sua senha.' }),
    crpNumber: z.string({ message: 'Informe o número do CRP.' }).refine(isValidCrpFormat, {
      message: 'CRP inválido. Use o formato NN/NNNNNNN (ex.: 06/123456).',
    }),
    crpUf: z
      .string({ message: 'Selecione a UF do CRP.' })
      .refine((value): value is UfCode => UF_SET.has(value as UfCode), {
        message: 'UF inválida.',
      }),
    acceptedTerms: z.literal(true, {
      message: 'Você precisa aceitar os Termos de Uso para continuar.',
    }),
    acceptedPrivacy: z.literal(true, {
      message: 'Você precisa aceitar a Política de Privacidade para continuar.',
    }),
    acceptedSensitiveData: z.literal(true, {
      message: 'Você precisa autorizar o tratamento de dados sensíveis para continuar.',
    }),
  })
  // Cross-field: password confirmation. Pinned to `passwordConfirm` so the
  // form highlights the right field.
  .refine((data) => data.password === data.passwordConfirm, {
    message: 'As senhas não coincidem.',
    path: ['passwordConfirm'],
  })
  // Cross-field: CRP regional code must match the selected UF. The error
  // is reported on `crpNumber` (the field whose 2-digit prefix is the
  // distinguishing piece of information) per the spec scenario, but the
  // pt-BR copy explicitly mentions both halves so the user can fix
  // either.
  .refine((data) => isCrpRegionalConsistentWithUf(data.crpNumber, data.crpUf), {
    message: 'O número do CRP não corresponde à UF selecionada.',
    path: ['crpNumber'],
  });

export type SignupInput = z.infer<typeof signupInputSchema>;
