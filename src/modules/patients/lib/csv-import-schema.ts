import { z } from 'zod';

// ---------------------------------------------------------------------------
// CSV Patient Row Schema (for import Server Action)
// ---------------------------------------------------------------------------

/**
 * Runtime validation schema for a single CSV patient row.
 *
 * Why: Server Actions receive untrusted input from the network. Even though the
 * client validates before sending, a crafted request could bypass the UI and
 * inject arbitrary shapes (oversized strings, unexpected types).
 */
export const csvPatientRowSchema = z.object({
  fullName: z.string().min(1).max(255),
  phone: z.string().max(30).nullish(),
  email: z.string().max(255).nullish(),
  birthDate: z.string().max(20).nullish(),
  tags: z.array(z.string().max(100)).max(20).optional(),
  notes: z.string().max(5000).nullish(),
});

export type CsvPatientRow = z.infer<typeof csvPatientRowSchema>;

/** Validates the full array of rows for a CSV import. */
export const importCsvInputSchema = z.array(csvPatientRowSchema).min(1).max(200);

// ---------------------------------------------------------------------------
// Duplicate Candidate Schema (for duplicate-check Server Action)
// ---------------------------------------------------------------------------

/** Runtime validation schema for a single duplicate-check candidate. */
export const duplicateCandidateSchema = z.object({
  phone: z.string().max(30).nullish(),
  email: z.string().max(255).nullish(),
});

export type DuplicateCandidate = z.infer<typeof duplicateCandidateSchema>;

/** Validates the full array of candidates for duplicate checking. */
export const checkDuplicatesInputSchema = z.array(duplicateCandidateSchema).min(1).max(200);

// ---------------------------------------------------------------------------
// Export Patient PDF Schema
// ---------------------------------------------------------------------------

/** Runtime validation schema for export-patient-pdf Server Action input. */
export const exportPatientPdfInputSchema = z.object({
  patientId: z.string().uuid(),
  includeClinicalData: z.boolean(),
});
