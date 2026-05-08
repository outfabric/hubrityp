import { z } from 'zod';

import { isValidBrazilianPhone, isValidCpf } from './patient-validators';

/**
 * Zod schemas for patient guardian CRUD operations.
 *
 * Single source of truth for:
 *   - React Hook Form resolvers (client-side inline errors)
 *   - Server Actions (reject tampered requests before touching the DB)
 *
 * Error messages are in pt-BR to match the product surface.
 *
 * Business rule: each patient may have at most 2 guardians (enforced at the
 * Server Action layer, not at the schema level — the schema validates a single
 * guardian payload).
 */

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

const fullNameField = z
  .string({ message: 'Informe o nome completo do responsável.' })
  .trim()
  .min(2, { message: 'O nome deve ter pelo menos 2 caracteres.' })
  .max(200, { message: 'O nome deve ter no máximo 200 caracteres.' });

const relationshipField = z
  .string({ message: 'Informe o parentesco.' })
  .trim()
  .min(2, { message: 'O parentesco deve ter pelo menos 2 caracteres.' })
  .max(100, { message: 'O parentesco deve ter no máximo 100 caracteres.' });

const phoneField = z
  .string({ message: 'Informe o telefone do responsável.' })
  .refine((v) => isValidBrazilianPhone(v), {
    message: 'Telefone inválido. Use o formato +55 DD NNNNN-NNNN.',
  });

const cpfField = z
  .string()
  .refine((v) => v === '' || isValidCpf(v), {
    message: 'CPF inválido.',
  })
  .optional();

const emailField = z
  .string()
  .email({ message: 'E-mail inválido.' })
  .max(255, { message: 'E-mail deve ter no máximo 255 caracteres.' })
  .optional()
  .or(z.literal(''));

// ---------------------------------------------------------------------------
// createGuardianSchema
// ---------------------------------------------------------------------------

/**
 * Schema for creating a new guardian for a patient.
 *
 * Required: full_name, relationship, phone.
 * Optional: cpf, email, is_primary.
 */
export const createGuardianSchema = z.object({
  fullName: fullNameField,
  relationship: relationshipField,
  phone: phoneField,
  cpf: cpfField,
  email: emailField,
  isPrimary: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// updateGuardianSchema — partial update
// ---------------------------------------------------------------------------

/**
 * Schema for partially updating a guardian. All fields are optional,
 * but validated when present.
 */
export const updateGuardianSchema = createGuardianSchema.partial();

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

/** Input for creating a guardian. */
export type CreateGuardianInput = z.infer<typeof createGuardianSchema>;

/** Input for partially updating a guardian. */
export type UpdateGuardianInput = z.infer<typeof updateGuardianSchema>;
