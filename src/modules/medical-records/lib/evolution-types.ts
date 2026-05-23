/**
 * Serializable types for evolution notes.
 *
 * Extracted from server/get-evolutions-by-patient.ts so that both server
 * and client code can reference them without pulling in server-only deps.
 */

export interface EvolutionSummary {
  id: string;
  patientId: string;
  sessionId: string | null;
  templateType: string;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
  finalizedAt: Date | null;
}
