/**
 * CSV column mapping for patient import.
 *
 * Maps CSV header names (typically in pt-BR) to internal patient field names.
 * Supports auto-detection via normalized header comparison (lowercase, trimmed,
 * accents stripped).
 *
 * Pure module — no I/O, safe to import from anywhere.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Internal patient fields that CSV columns can map to. */
export type PatientField = 'full_name' | 'phone' | 'email' | 'birth_date' | 'tags' | 'notes';

/** Result of auto-detecting column mappings for a set of CSV headers. */
export interface ColumnMappingResult {
  /** Successfully mapped columns: CSV header → patient field. */
  mapped: Record<string, PatientField>;
  /** CSV headers that could not be auto-mapped. */
  unmapped: string[];
}

// ---------------------------------------------------------------------------
// Known header aliases (normalized → field)
// ---------------------------------------------------------------------------

/**
 * Lookup table from normalized header strings to patient fields.
 *
 * Supports common pt-BR and EN variations. All keys are lowercase, trimmed,
 * and accent-stripped so matching is resilient to user formatting.
 */
const HEADER_ALIASES: Record<string, PatientField> = {
  // full_name
  nome: 'full_name',
  'nome completo': 'full_name',
  name: 'full_name',
  'full name': 'full_name',
  full_name: 'full_name',
  fullname: 'full_name',
  paciente: 'full_name',

  // phone
  telefone: 'phone',
  celular: 'phone',
  phone: 'phone',
  tel: 'phone',
  whatsapp: 'phone',
  fone: 'phone',

  // email
  email: 'email',
  'e-mail': 'email',
  e_mail: 'email',

  // birth_date
  'data de nascimento': 'birth_date',
  data_nascimento: 'birth_date',
  'data nascimento': 'birth_date',
  nascimento: 'birth_date',
  'birth date': 'birth_date',
  birth_date: 'birth_date',
  birthdate: 'birth_date',
  'dt nascimento': 'birth_date',
  'dt. nascimento': 'birth_date',

  // tags
  tags: 'tags',
  tag: 'tags',
  etiquetas: 'tags',
  categorias: 'tags',

  // notes
  observacao: 'notes',
  observacoes: 'notes',
  observação: 'notes',
  observações: 'notes',
  anotacao: 'notes',
  anotação: 'notes',
  anotacoes: 'notes',
  anotações: 'notes',
  notas: 'notes',
  notes: 'notes',
  obs: 'notes',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes a header string for comparison: trims, lowercases, and strips
 * combining diacritical marks (accents). This lets "Observação" match
 * "observacao" and " Nome " match "nome".
 */
export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** All patient fields available for CSV mapping. */
export const PATIENT_FIELDS: readonly PatientField[] = [
  'full_name',
  'phone',
  'email',
  'birth_date',
  'tags',
  'notes',
] as const;

/**
 * Auto-detects column mappings for a list of CSV headers.
 *
 * For each header, the function normalizes it (lowercase, strip accents,
 * trim) and looks it up in the known alias table. Each patient field can
 * only be mapped once — if two headers resolve to the same field, the
 * first one wins and the second is placed in `unmapped`.
 *
 * @param headers - Raw CSV header strings (first row of the file).
 * @returns An object with `mapped` (header→field) and `unmapped` headers.
 */
export function detectColumnMapping(headers: string[]): ColumnMappingResult {
  const mapped: Record<string, PatientField> = {};
  const unmapped: string[] = [];
  const usedFields = new Set<PatientField>();

  for (const header of headers) {
    const normalized = normalizeHeader(header);
    const field = HEADER_ALIASES[normalized];

    if (field && !usedFields.has(field)) {
      mapped[header] = field;
      usedFields.add(field);
    } else {
      unmapped.push(header);
    }
  }

  return { mapped, unmapped };
}
