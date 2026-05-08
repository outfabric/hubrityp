import type { z } from 'zod';

import type {
  createPatientSchema,
  listPatientsQuerySchema,
  updatePatientSchema,
} from './patient-input-schema';

/**
 * Domain types for the patient module.
 *
 * Enums/unions are defined here as the source of truth and imported by the
 * Zod schemas (via `.enum()`), keeping the type definitions and validators
 * in sync without duplication.
 */

// ---------------------------------------------------------------------------
// Enum value constants
// ---------------------------------------------------------------------------

/**
 * Patient type discriminator. Maps to `patient_type` column.
 * "individual" is the default for backwards compatibility.
 */
export const PATIENT_TYPES = ['individual', 'child', 'adolescent', 'couple', 'elderly'] as const;
export type PatientType = (typeof PATIENT_TYPES)[number];

/**
 * Patient lifecycle status. Maps to `status` column.
 */
export const PATIENT_STATUSES = ['active', 'archived'] as const;
export type PatientStatus = (typeof PATIENT_STATUSES)[number];

/**
 * Gender options for the demographic field.
 */
export const GENDERS = ['male', 'female', 'non_binary', 'other', 'prefer_not_to_say'] as const;
export type Gender = (typeof GENDERS)[number];

/**
 * Marital status options.
 */
export const MARITAL_STATUSES = [
  'single',
  'married',
  'divorced',
  'widowed',
  'civil_union',
  'other',
] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];

/**
 * How the patient was referred to the psychologist.
 */
export const SOURCES = [
  'indication',
  'social_media',
  'google',
  'insurance',
  'return',
  'other',
] as const;
export type Source = (typeof SOURCES)[number];

/**
 * Valid sort columns for the patient list query.
 */
export const SORT_COLUMNS = ['full_name', 'created_at', 'updated_at'] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];

/**
 * Sort order (ascending/descending).
 */
export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

// ---------------------------------------------------------------------------
// Label maps (pt-BR display strings — single source of truth)
// ---------------------------------------------------------------------------

/** Human-readable patient type labels. */
export const PATIENT_TYPE_LABELS: Record<string, string> = {
  individual: 'Adulto',
  child: 'Criança',
  adolescent: 'Adolescente',
  couple: 'Casal',
  elderly: 'Idoso',
} satisfies Record<PatientType, string>;

/** Human-readable gender labels. */
export const GENDER_LABELS: Record<string, string> = {
  male: 'Masculino',
  female: 'Feminino',
  non_binary: 'Não-binário',
  other: 'Outro',
  prefer_not_to_say: 'Prefiro não dizer',
} satisfies Record<Gender, string>;

/** Human-readable marital status labels. */
export const MARITAL_STATUS_LABELS: Record<string, string> = {
  single: 'Solteiro(a)',
  married: 'Casado(a)',
  divorced: 'Divorciado(a)',
  widowed: 'Viúvo(a)',
  civil_union: 'União estável',
  other: 'Outro',
} satisfies Record<MaritalStatus, string>;

/** Human-readable source labels. */
export const SOURCE_LABELS: Record<string, string> = {
  indication: 'Indicação',
  social_media: 'Redes sociais',
  google: 'Google',
  insurance: 'Convênio',
  return: 'Retorno',
  other: 'Outro',
} satisfies Record<Source, string>;

// ---------------------------------------------------------------------------
// Input/Output types (derived from Zod schemas)
// ---------------------------------------------------------------------------

/** Input for creating a patient (both step 1 essentials and step 2 details). */
export type CreatePatientInput = z.infer<typeof createPatientSchema>;

/** Input for partially updating a patient. */
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;

/** Query parameters for listing patients (pagination, filter, sort). */
export type ListPatientsQuery = z.infer<typeof listPatientsQuerySchema>;
