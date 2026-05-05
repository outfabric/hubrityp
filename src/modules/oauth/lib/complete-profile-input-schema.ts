import { z } from 'zod';

import { isValidCrpFormat } from '@/modules/registration/lib/crp-validators';
import { isCrpRegionalConsistentWithUf } from '@/modules/registration/lib/crp-validators';
import { UF_SET, type UfCode } from '@/modules/registration/lib/uf-table';

/**
 * Validation schema for completing an OAuth profile.
 *
 * After an OAuth sign-in (e.g. Google), the user already has a session but
 * is missing the professional fields required to use the platform. This
 * schema covers those mandatory fields — WITHOUT email and password, which
 * are already provided by the OAuth provider.
 *
 * Reuses validators from the registration module for CRP format, UF
 * membership, regional/UF consistency, full name length, and consent flags.
 *
 * Pure module — no I/O.
 */
const baseCompleteProfileSchema = z.object({
  fullName: z
    .string({ message: 'Informe seu nome completo.' })
    .trim()
    .min(3, { message: 'O nome deve ter pelo menos 3 caracteres.' })
    .max(120, { message: 'O nome deve ter no máximo 120 caracteres.' }),
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
});

export const completeProfileInputSchema = baseCompleteProfileSchema.refine(
  (data) => isCrpRegionalConsistentWithUf(data.crpNumber, data.crpUf),
  {
    message: 'O número do CRP não corresponde à UF selecionada.',
    path: ['crpNumber'],
  },
);

export type CompleteProfileInput = z.infer<typeof completeProfileInputSchema>;
