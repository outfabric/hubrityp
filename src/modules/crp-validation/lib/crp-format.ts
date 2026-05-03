import { z } from 'zod';

import { BRAZILIAN_UFS, regionalCodeToUf } from './regional-codes';

// Synchronous CRP format validation, mirrored at every entry point that
// accepts a CRP from a user (signup form, profile update, admin queue
// insertion) per the spec ("CRP number format is validated synchronously at
// the form boundary"). The schema is intentionally pure Zod so the same
// validator runs in the browser (form layer) and on the server (Server
// Actions, factories, integration tests) without environment branching.
//
// Format: `^\d{2}/\d{4,7}$` — a two-digit regional prefix, a literal slash,
// and a 4- to 7-digit inscription number. Anything else (wrong delimiter,
// short/long inscription, embedded whitespace) is rejected up-front by the
// regex; the `.refine` then narrows the regional prefix to one of the codes
// listed in PRD 01 Apêndice A.
//
// Error messages are deliberately user-readable (Portuguese) — they bubble up
// to the form's inline error, so they MUST be human-grade, not technical
// (e.g. "Use o formato XX/NNNNNN" rather than "Regex mismatch"). They also
// distinguish format errors from regional-code errors, satisfying the spec
// scenarios "Wrong delimiter is rejected" vs "Out-of-range regional code is
// rejected".
const CRP_FORMAT_PATTERN = /^\d{2}\/\d{4,7}$/;

export const crpNumberSchema = z
  .string()
  .regex(CRP_FORMAT_PATTERN, {
    message: 'CRP inválido. Use o formato XX/NNNNNN (ex.: 06/123456).',
  })
  .refine(
    (value) => {
      const prefix = value.slice(0, 2);
      return regionalCodeToUf(prefix) !== null;
    },
    {
      message: 'Código regional do CRP desconhecido.',
    },
  );

export type CrpNumber = z.infer<typeof crpNumberSchema>;

// Closed enum of the 27 Brazilian state UFs. Spec invariant: lower-case input
// MUST be rejected — the form Client Component is responsible for
// upper-casing before submit (scenario "Lower-case UF is rejected").
export const crpUfSchema = z.enum(BRAZILIAN_UFS, {
  message: 'UF do CRP inválida.',
});

export type CrpUf = z.infer<typeof crpUfSchema>;
