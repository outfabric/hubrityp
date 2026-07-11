/**
 * Platform template contract — the single source of truth for the named
 * `contentVariables` and the platform Content SID of each platform-owned
 * WhatsApp reminder template.
 *
 * In the shared-number MVP the platform registers four fixed Content templates
 * in its Twilio WABA. Each template is defined in Twilio's Content Template
 * Builder with a fixed set of *named* variables (`first_name`, `date`, ...) —
 * NOT the 12-variable PT dictionary in `template-variables.ts`, which now only
 * feeds the (future) editing UI. Outbound reminder sends build their
 * `contentVariables` here so the payload matches what Twilio expects.
 *
 * Twilio rejects sends whose variables carry newlines (error 92007) or whose
 * keys fall outside the template's declared set (error 63028). This module
 * therefore strips newlines from every value and emits only the declared keys.
 *
 * @see design.md D1/D2 — whatsapp-mvp-platform-templates-alignment
 */

import { formatInTimeZone } from 'date-fns-tz';

import { serverEnv } from '@/shared/env';

const SAO_PAULO_TZ = 'America/Sao_Paulo';

/**
 * The clinical/session context from which the named template variables are
 * resolved. All values are server-side and owner-scoped by the caller — this
 * module only formats them; it performs no authorization.
 */
export interface ContentVariableContext {
  /** Patient's full name — `first_name` is extracted from its first token. */
  patientFullName: string;
  /** Psychologist's display name, used for `professional_name`. */
  professionalName: string;
  /** Session start instant (UTC); formatted to `America/Sao_Paulo` local. */
  startAt: Date;
  /** Patient-facing session/video link — required only by `link_video`. */
  sessionLink?: string | null;
}

interface VariableDefinition {
  name: string;
  /** Resolves the raw (pre-sanitization) value from the context. */
  resolve: (ctx: ContentVariableContext) => string;
}

/**
 * Extracts the first name (first whitespace-delimited token) from a full name.
 * Runs before sanitization, so any newline in the full name is treated as
 * whitespace and never leaks into the value.
 */
function extractFirstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? '';
}

const firstNameVariable: VariableDefinition = {
  name: 'first_name',
  resolve: (ctx) => extractFirstName(ctx.patientFullName),
};

const professionalNameVariable: VariableDefinition = {
  name: 'professional_name',
  resolve: (ctx) => ctx.professionalName,
};

const dateVariable: VariableDefinition = {
  name: 'date',
  resolve: (ctx) => formatInTimeZone(ctx.startAt, SAO_PAULO_TZ, 'dd/MM/yyyy'),
};

const timeVariable: VariableDefinition = {
  name: 'time',
  resolve: (ctx) => formatInTimeZone(ctx.startAt, SAO_PAULO_TZ, 'HH:mm'),
};

const sessionLinkVariable: VariableDefinition = {
  name: 'session_link',
  resolve: (ctx) => ctx.sessionLink ?? '',
};

interface TemplateDefinition {
  /** `serverEnv` key holding this template's platform Content SID. */
  envVar:
    | 'TWILIO_CONTENT_SID_LEMBRETE_24H'
    | 'TWILIO_CONTENT_SID_LEMBRETE_2H'
    | 'TWILIO_CONTENT_SID_LINK_VIDEO'
    | 'TWILIO_CONTENT_SID_CANCELAMENTO_AVISO';
  variables: readonly VariableDefinition[];
}

/**
 * Declarative contract — one entry per platform Content template. The variable
 * order and names MUST mirror each template's definition in Twilio's Content
 * Template Builder.
 */
const PLATFORM_TEMPLATE_CONTRACT = {
  lembrete_24h: {
    envVar: 'TWILIO_CONTENT_SID_LEMBRETE_24H',
    variables: [firstNameVariable, professionalNameVariable, dateVariable, timeVariable],
  },
  lembrete_2h: {
    envVar: 'TWILIO_CONTENT_SID_LEMBRETE_2H',
    variables: [firstNameVariable, professionalNameVariable, timeVariable],
  },
  link_video: {
    envVar: 'TWILIO_CONTENT_SID_LINK_VIDEO',
    variables: [
      firstNameVariable,
      professionalNameVariable,
      dateVariable,
      timeVariable,
      sessionLinkVariable,
    ],
  },
  cancelamento_aviso: {
    envVar: 'TWILIO_CONTENT_SID_CANCELAMENTO_AVISO',
    variables: [firstNameVariable, professionalNameVariable, dateVariable, timeVariable],
  },
} as const satisfies Record<string, TemplateDefinition>;

/** The four platform-owned reminder template keys. */
export type PlatformTemplateKey = keyof typeof PLATFORM_TEMPLATE_CONTRACT;

/** Type guard — narrows an arbitrary string to a platform template key. */
export function isPlatformTemplateKey(templateKey: string): templateKey is PlatformTemplateKey {
  return templateKey in PLATFORM_TEMPLATE_CONTRACT;
}

/**
 * Removes newline characters (Twilio error 92007) by collapsing them to a
 * single space, then trims. A value that sanitizes to empty is invalid.
 */
function sanitizeValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Builds the named `contentVariables` for a platform Content template.
 *
 * Emits exactly the keys declared for `templateKey` (Twilio error 63028) and
 * strips newlines from every value (Twilio error 92007). Throws when any
 * resolved value is empty — a missing required value (e.g. an unresolved
 * `session_link`) must fail loudly rather than send a malformed template.
 */
export function buildContentVariables(
  templateKey: PlatformTemplateKey,
  ctx: ContentVariableContext,
): Record<string, string> {
  const definition = PLATFORM_TEMPLATE_CONTRACT[templateKey];

  const variables: Record<string, string> = {};
  for (const variable of definition.variables) {
    const value = sanitizeValue(variable.resolve(ctx));
    if (value.length === 0) {
      throw new Error(
        `Empty value for template variable "${variable.name}" in template "${templateKey}"`,
      );
    }
    variables[variable.name] = value;
  }

  return variables;
}

/**
 * Resolves the platform Content SID for a template key, reading it from
 * `serverEnv` (boot-validated, always present for the four platform keys).
 * Returns `null` for any non-platform key (e.g. `termo_consentimento`), which
 * lets the seeder stamp only reminder rows with a SID.
 */
export function resolvePlatformContentSid(templateKey: string): string | null {
  if (!isPlatformTemplateKey(templateKey)) return null;
  return serverEnv[PLATFORM_TEMPLATE_CONTRACT[templateKey].envVar];
}
