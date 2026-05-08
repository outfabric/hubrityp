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
// Input/Output types (derived from Zod schemas)
// ---------------------------------------------------------------------------

/** Input for creating a patient (both step 1 essentials and step 2 details). */
export type CreatePatientInput = z.infer<typeof createPatientSchema>;

/** Input for partially updating a patient. */
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;

/** Query parameters for listing patients (pagination, filter, sort). */
export type ListPatientsQuery = z.infer<typeof listPatientsQuerySchema>;
