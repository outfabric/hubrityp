/**
 * Canonical Brazilian UF set + CRP regional code → UF mapping.
 *
 * Pure module with zero runtime dependencies — safe to import from Client
 * Components, Server Actions, Edge runtime, and Node tests alike.
 *
 * The mapping is sourced from Apêndice A do PRD (Conselho Federal de
 * Psicologia regional councils). Some regional councils historically cover
 * more than one UF — most notably CRP-20, which encompasses Amazonas,
 * Roraima, Acre, and Rondônia. The shape is therefore `Record<string,
 * readonly UfCode[]>`, not `Record<string, UfCode>`, so every consumer
 * iterates correctly without having to special-case multi-UF councils.
 *
 * The set of UFs is the closed set of 27 Brazilian federative units
 * (26 states + DF). It is the single source of truth for `crpUf` validation
 * in `signupInputSchema` and elsewhere; do NOT inline UF lists at call
 * sites.
 */

/** All 27 Brazilian UF codes — 26 states plus the Federal District. */
export const UFS = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const satisfies readonly string[];

export type UfCode = (typeof UFS)[number];

/** Set form — for fast membership checks (`UF_SET.has(value)`). */
export const UF_SET: ReadonlySet<UfCode> = new Set(UFS);

/**
 * CRP regional code (2-digit prefix) → list of UFs covered by that council.
 *
 * Per Apêndice A do PRD:
 *   01 → DF, 02 → PE, 03 → BA, 04 → MG, 05 → RJ, 06 → SP, 07 → RS,
 *   08 → PR, 09 → GO, 10 → PA, 11 → CE, 12 → SC, 13 → PB, 14 → MS,
 *   15 → AL, 16 → ES, 17 → RN, 18 → MT, 19 → SE, 20 → AM/RR/AC/RO,
 *   21 → PI, 22 → MA, 23 → TO, 24 → AP.
 *
 * CRP-20 is intentionally retained as a multi-UF council to match the
 * canonical CFP listing referenced in the PRD; splitting it out would
 * require a CFP-issued reorganization not yet reflected in their public
 * directory.
 */
export const regionalCodeToUf: Readonly<Record<string, readonly UfCode[]>> = {
  '01': ['DF'],
  '02': ['PE'],
  '03': ['BA'],
  '04': ['MG'],
  '05': ['RJ'],
  '06': ['SP'],
  '07': ['RS'],
  '08': ['PR'],
  '09': ['GO'],
  '10': ['PA'],
  '11': ['CE'],
  '12': ['SC'],
  '13': ['PB'],
  '14': ['MS'],
  '15': ['AL'],
  '16': ['ES'],
  '17': ['RN'],
  '18': ['MT'],
  '19': ['SE'],
  '20': ['AM', 'RR', 'AC', 'RO'],
  '21': ['PI'],
  '22': ['MA'],
  '23': ['TO'],
  '24': ['AP'],
} as const;
