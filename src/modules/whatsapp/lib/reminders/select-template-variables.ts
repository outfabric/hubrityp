/**
 * Selects and fills template variables for a reminder message.
 *
 * Pure function — maps session/patient/psychologist/location data to the
 * 12 PRD-defined variables based on the reminder kind. Variables not
 * applicable to the given kind are omitted from the result.
 *
 * @see PRD RF-04.08, template-variables.ts
 */

import { ptBR } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';

import type { TemplateKey } from '../template-key-schema';
import { TEMPLATE_VARIABLES } from '../template-variables';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal session data needed for variable resolution. */
export interface SessionForVariables {
  startAt: Date;
  durationMinutes: number;
  modality: string;
  videoLink?: string | null;
  confirmationLink?: string | null;
  cancelMessage?: string | null;
  sessionValue?: number | null;
}

/** Minimal patient data needed for variable resolution. */
export interface PatientForVariables {
  firstName: string;
  fullName: string;
}

/** Minimal psychologist data needed for variable resolution. */
export interface PsychologistForVariables {
  displayName: string;
}

/** Minimal location data needed for variable resolution. */
export interface LocationForVariables {
  name: string;
  address?: string | null;
  arrivalInstructions?: string | null;
}

// ---------------------------------------------------------------------------
// Kind → TemplateKey mapping
// ---------------------------------------------------------------------------

/**
 * Maps the semantic reminder kind to the TemplateKey used in the
 * template_variables dictionary's `applicableTemplates` field.
 */
const KIND_TO_TEMPLATE_KEY: Record<string, TemplateKey> = {
  early: 'lembrete_24h',
  final: 'lembrete_2h',
  video: 'link_video',
  cancelled: 'cancelamento_aviso',
  confirmed_ack: 'confirmacao_recebida',
  consent: 'termo_consentimento',
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAO_PAULO_TZ = 'America/Sao_Paulo';

// ---------------------------------------------------------------------------
// Value resolvers
// ---------------------------------------------------------------------------

/**
 * For each variable key, a function that resolves its value from the
 * available context. Returns undefined when the value is not available
 * (the variable will be omitted from the result).
 */
function resolveVariableValue(
  key: string,
  session: SessionForVariables,
  patient: PatientForVariables,
  psychologist: PsychologistForVariables,
  location: LocationForVariables | null,
): string | undefined {
  switch (key) {
    case 'nome_paciente':
      return patient.firstName;
    case 'nome_completo':
      return patient.fullName;
    case 'nome_psicologo':
      return psychologist.displayName;
    case 'data':
      return formatInTimeZone(session.startAt, SAO_PAULO_TZ, "dd/MM/yyyy", {
        locale: ptBR,
      });
    case 'dia_semana':
      return formatInTimeZone(session.startAt, SAO_PAULO_TZ, 'EEEE', {
        locale: ptBR,
      });
    case 'hora':
      return formatInTimeZone(session.startAt, SAO_PAULO_TZ, 'HH:mm', {
        locale: ptBR,
      });
    case 'duracao_min':
      return String(session.durationMinutes);
    case 'endereco':
      if (location?.address) return location.address;
      if (location?.name) return location.name;
      return undefined;
    case 'instrucao_chegada':
      return location?.arrivalInstructions ?? undefined;
    case 'link_confirmacao':
      return session.confirmationLink ?? undefined;
    case 'link_video':
      if (session.modality !== 'online') return undefined;
      return session.videoLink ?? undefined;
    case 'valor':
      if (session.sessionValue == null) return undefined;
      return `R$ ${session.sessionValue.toFixed(2).replace('.', ',')}`;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Returns a map of variable key → resolved value for the given reminder kind.
 *
 * Only variables that are applicable to the template key corresponding to
 * `kind` are included. Variables whose value cannot be resolved (e.g.,
 * link_video for in-person sessions) are omitted.
 */
export function selectTemplateVariables(
  session: SessionForVariables,
  patient: PatientForVariables,
  psychologist: PsychologistForVariables,
  location: LocationForVariables | null,
  kind: string,
): Record<string, string> {
  const templateKey = KIND_TO_TEMPLATE_KEY[kind];
  if (!templateKey) return {};

  const result: Record<string, string> = {};

  for (const variable of TEMPLATE_VARIABLES) {
    // Only include variables applicable to this template type
    if (!(variable.applicableTemplates as readonly string[]).includes(templateKey)) continue;

    const value = resolveVariableValue(
      variable.key,
      session,
      patient,
      psychologist,
      location,
    );

    if (value !== undefined) {
      result[variable.key] = value;
    }
  }

  return result;
}
