// CRP regional code → UF mapping, sourced verbatim from PRD 01 Apêndice A.
//
// PRD 01 Apêndice A enumerates 24 regional CRP codes (`01` through `24`).
// RR, AP, and TO are NOT assigned a regional code by the Conselho Federal de
// Psicologia — those states are served by neighboring CRPs in practice. The
// `crpUfSchema` Zod enum still covers all 27 Brazilian UFs (a psychologist
// MAY register declaring a state of practice that does not have its own
// regional CRP code), but that ambiguity is independent of this mapping.
//
// Spec invariant: this file is the single source of truth for the mapping.
// Duplicating it elsewhere is forbidden — the `crp-validation` spec lists
// "Consumers MUST use this constant" as a requirement.

// All 27 Brazilian UFs as a literal-typed tuple. Reused by `crpUfSchema` so
// the Zod enum stays in lock-step with the type system.
export const BRAZILIAN_UFS = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
] as const;

export type Uf = (typeof BRAZILIAN_UFS)[number];

// `as const` preserves literal types, so `regionalCodes['06']` resolves to
// `'SP'` (not `string`). Matches PRD 01 Apêndice A in order:
//   01→DF, 02→RJ, 03→MG, 04→RS, 05→BA, 06→SP, 07→PE, 08→PR, 09→SC, 10→CE,
//   11→ES, 12→PB, 13→AM, 14→PA, 15→GO, 16→MA, 17→MS, 18→MT, 19→RN, 20→AL,
//   21→PI, 22→SE, 23→AC, 24→RO
export const regionalCodes = {
  '01': 'DF',
  '02': 'RJ',
  '03': 'MG',
  '04': 'RS',
  '05': 'BA',
  '06': 'SP',
  '07': 'PE',
  '08': 'PR',
  '09': 'SC',
  '10': 'CE',
  '11': 'ES',
  '12': 'PB',
  '13': 'AM',
  '14': 'PA',
  '15': 'GO',
  '16': 'MA',
  '17': 'MS',
  '18': 'MT',
  '19': 'RN',
  '20': 'AL',
  '21': 'PI',
  '22': 'SE',
  '23': 'AC',
  '24': 'RO',
} as const satisfies Record<string, Uf>;

export type RegionalCode = keyof typeof regionalCodes;

// Map a 2-character regional code to its UF, or `null` if the code is not
// known to PRD 01 Apêndice A.
//
// Argument type is `string` (not `RegionalCode`) on purpose — callers are
// validating untrusted input from the form layer, so the helper MUST accept
// any string and decide. If you already have a `RegionalCode`, the lookup
// `regionalCodes[code]` is type-safe and cheaper.
export function regionalCodeToUf(code: string): Uf | null {
  if (Object.prototype.hasOwnProperty.call(regionalCodes, code)) {
    return regionalCodes[code as RegionalCode];
  }
  return null;
}
