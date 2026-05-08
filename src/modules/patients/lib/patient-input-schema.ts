import { z } from 'zod';

import {
  GENDERS,
  MARITAL_STATUSES,
  PATIENT_STATUSES,
  PATIENT_TYPES,
  SORT_COLUMNS,
  SORT_ORDERS,
  SOURCES,
} from './patient-types';
import { isValidBrazilianPhone, isValidCpf } from './patient-validators';

/**
 * Zod schemas for patient CRUD operations.
 *
 * Single source of truth for:
 *   - React Hook Form resolvers (client-side inline errors)
 *   - Server Actions (reject tampered requests before touching the DB)
 *
 * Error messages are in pt-BR to match the product surface.
 */

// ---------------------------------------------------------------------------
// Shared field schemas (reused across create and update)
// ---------------------------------------------------------------------------

const fullNameField = z
  .string({ message: 'Informe o nome completo.' })
  .trim()
  .min(2, { message: 'O nome deve ter pelo menos 2 caracteres.' })
  .max(200, { message: 'O nome deve ter no máximo 200 caracteres.' });

const patientTypeField = z.enum(PATIENT_TYPES, {
  message: 'Tipo de paciente inválido.',
});

const phoneField = z
  .string()
  .refine((v) => v === '' || isValidBrazilianPhone(v), {
    message: 'Telefone inválido. Use o formato +55 DD NNNNN-NNNN.',
  })
  .optional();

const emailField = z
  .string()
  .email({ message: 'E-mail inválido.' })
  .max(255, { message: 'E-mail deve ter no máximo 255 caracteres.' })
  .optional()
  .or(z.literal(''));

const cpfField = z
  .string()
  .refine((v) => v === '' || isValidCpf(v), {
    message: 'CPF inválido.',
  })
  .optional();

const tagsField = z
  .array(z.string().trim().min(1).max(50))
  .max(30, { message: 'Máximo de 30 tags permitidas.' })
  .transform((tags) => tags.map((t) => t.toLowerCase()))
  .optional();

const addressField = z
  .object({
    street: z.string().max(200).optional(),
    number: z.string().max(20).optional(),
    complement: z.string().max(100).optional(),
    neighborhood: z.string().max(100).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(2).optional(),
    zipCode: z.string().max(10).optional(),
  })
  .optional();

// ---------------------------------------------------------------------------
// createPatientSchema — step 1 (essentials) + step 2 (details)
// ---------------------------------------------------------------------------

/**
 * Schema for creating a new patient. Covers both the 2-step form:
 *   - Step 1 (required): fullName, patientType
 *   - Step 2 (optional): everything else
 */
export const createPatientSchema = z.object({
  // Step 1 — required
  fullName: fullNameField,
  patientType: patientTypeField,

  // Step 2 — optional demographics
  birthDate: z.coerce.date().optional(),
  approximateAge: z
    .string()
    .max(20, { message: 'Idade aproximada deve ter no máximo 20 caracteres.' })
    .optional(),
  gender: z.enum(GENDERS, { message: 'Gênero inválido.' }).optional(),

  // Contact
  phone: phoneField,
  email: emailField,

  // Documents
  cpf: cpfField,

  // Address
  address: addressField,

  // Professional/social
  profession: z
    .string()
    .max(100, { message: 'Profissão deve ter no máximo 100 caracteres.' })
    .optional(),
  maritalStatus: z.enum(MARITAL_STATUSES, { message: 'Estado civil inválido.' }).optional(),
  source: z.enum(SOURCES, { message: 'Origem do encaminhamento inválida.' }).optional(),

  // Tags
  tags: tagsField,

  // Notes
  notes: z
    .string()
    .max(5000, { message: 'Anotações devem ter no máximo 5000 caracteres.' })
    .optional(),
});

// ---------------------------------------------------------------------------
// updatePatientSchema — partial update
// ---------------------------------------------------------------------------

/**
 * Schema for partially updating a patient. All fields are optional.
 * Includes `status` to allow archiving/reactivation.
 */
export const updatePatientSchema = createPatientSchema.partial().extend({
  status: z.enum(PATIENT_STATUSES, { message: 'Status inválido.' }).optional(),
});

// ---------------------------------------------------------------------------
// listPatientsQuerySchema — pagination, filtering, sorting
// ---------------------------------------------------------------------------

/**
 * Schema for the patient list query parameters. Used to validate
 * search/filter/sort params before building the Drizzle query.
 */
export const listPatientsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  status: z.enum(PATIENT_STATUSES).optional(),
  search: z.string().max(200).optional(),
  tags: z.union([z.string().transform((s) => s.split(',')), z.array(z.string())]).optional(),
  sort: z.enum(SORT_COLUMNS).default('full_name'),
  order: z.enum(SORT_ORDERS).default('asc'),
});
