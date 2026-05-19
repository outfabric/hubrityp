import { z } from 'zod';

/**
 * Zod schemas for prontuario PDF export filters and section toggles.
 *
 * Used at the Server Action boundary (`requestExport`) to validate user
 * input before enqueuing the Inngest job, and by the Inngest job itself
 * to deserialize the `filters` JSONB column from `prontuario_exports`.
 */

// ---------------------------------------------------------------------------
// Section toggles — which parts of the prontuario to include
// ---------------------------------------------------------------------------

export const exportSectionsSchema = z.object({
  anamnese: z.boolean().default(true),
  evolucoes: z.boolean().default(true),
  hipoteses: z.boolean().default(true),
  planoTerapeutico: z.boolean().default(true),
  escalas: z.boolean().default(true),
  documentos: z.boolean().default(true),
  anexosIndex: z.boolean().default(true),
});

export type ExportSections = z.infer<typeof exportSectionsSchema>;

// ---------------------------------------------------------------------------
// Full export filters
// ---------------------------------------------------------------------------

export const exportFiltersSchema = z.object({
  dateRange: z
    .object({
      from: z.string().datetime().nullable().default(null),
      to: z.string().datetime().nullable().default(null),
    })
    .default({ from: null, to: null }),
  sections: exportSectionsSchema.default({
    anamnese: true,
    evolucoes: true,
    hipoteses: true,
    planoTerapeutico: true,
    escalas: true,
    documentos: true,
    anexosIndex: true,
  }),
  includePersonalNotes: z.boolean().default(false),
  deliveryEmail: z.string().email().optional(),
});

export type ExportFilters = z.infer<typeof exportFiltersSchema>;
