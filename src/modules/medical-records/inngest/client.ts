/**
 * Inngest client for the medical-records module.
 *
 * Re-uses the same application-level Inngest client ID ('hubrityp') so that
 * all functions register under a single app in the Inngest dashboard. The
 * WhatsApp module uses the same pattern — a shared `id` with per-module
 * client files for organizational clarity.
 */

import { Inngest } from 'inngest';

// ---------------------------------------------------------------------------
// Event data types
// ---------------------------------------------------------------------------

/** Data payload for `documents/pdf.requested` — triggered after finalization. */
export interface PdfRequestedEventData {
  /** UUID of the clinical_documents row to generate a PDF for. */
  documentId: string;
}

/** Data payload for `prontuario/export-pdf` — triggered after export request. */
export interface ProntuarioExportPdfEventData {
  /** UUID of the prontuario_exports row to process. */
  exportId: string;
}

// ---------------------------------------------------------------------------
// Event name constants
// ---------------------------------------------------------------------------

export const MEDICAL_RECORDS_EVENTS = {
  PDF_REQUESTED: 'documents/pdf.requested',
  PRONTUARIO_EXPORT_PDF: 'prontuario/export-pdf',
} as const;

// ---------------------------------------------------------------------------
// Inngest client
// ---------------------------------------------------------------------------

export const inngest = new Inngest({ id: 'hubrityp' });
