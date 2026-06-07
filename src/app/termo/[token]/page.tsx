import { AlertCircle, Info } from 'lucide-react';

import { AiConsentTemplateSchema } from '@/modules/ai-transcription';
import { getAiConsentByTokenImpl, getConsentByTokenImpl } from '@/modules/patients';
import { ConsentSignForm } from '@/modules/patients/components/consent-sign-form';
import { Card, CardContent } from '@/shared/ui/card';

import { AiConsentView } from './_components/ai-consent-view';
import { signAiConsent, signConsent } from './actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConsentPageProps {
  params: Promise<{ token: string }>;
}

// ---------------------------------------------------------------------------
// Page component (Server Component)
// ---------------------------------------------------------------------------

/**
 * Public consent signing page.
 *
 * This page is outside the `(app)` route group -- no authentication required.
 * The signature token in the URL is the authorization credential (256 bits of
 * entropy). The middleware classifies `/termo` as `public` and passes through.
 *
 * Token format determines which consent type to look up:
 *   - 64-char hex string: general consent (existing flow)
 *   - 43-char base64url string: AI recording consent (new flow)
 *
 * For AI consent, the template snapshot is validated against
 * `AiConsentTemplateSchema` before rendering to ensure data integrity.
 */
export default async function ConsentPage({ params }: ConsentPageProps) {
  const { token } = await params;

  // Dispatch based on token format:
  // - hex (64 chars) -> general consent
  // - base64url (43 chars) -> AI consent
  const isHexToken = /^[0-9a-f]{64}$/.test(token);
  const isBase64UrlToken = /^[A-Za-z0-9_-]{43}$/.test(token);

  // Try AI consent lookup for base64url tokens
  if (isBase64UrlToken && !isHexToken) {
    const aiResult = await getAiConsentByTokenImpl(token);

    if (aiResult.ok) {
      return renderAiConsent(token, aiResult.data);
    }

    // If AI lookup failed, fall through to not-found
    return renderNotFound();
  }

  // General consent lookup for hex tokens
  if (isHexToken) {
    const result = await getConsentByTokenImpl(token);

    if (!result.ok) {
      return renderNotFound();
    }

    const { data } = result;

    if (data.alreadySigned) {
      return renderAlreadySigned();
    }

    return renderGeneralConsent(token, data);
  }

  // Unknown token format
  return renderNotFound();
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderNotFound() {
  return (
    <div
      className="flex flex-col items-center gap-3 py-16 text-center"
      data-testid="consent-not-found"
    >
      <AlertCircle className="text-danger-500 h-12 w-12" aria-hidden="true" />
      <h3 className="text-text-primary text-lg leading-tight font-semibold">
        Termo nao encontrado
      </h3>
      <p className="text-text-secondary text-[15px]">
        O link pode ter expirado ou ser invalido. Entre em contato com seu psicologo.
      </p>
    </div>
  );
}

function renderAlreadySigned() {
  return (
    <div
      className="flex flex-col items-center gap-3 py-16 text-center"
      data-testid="consent-already-signed"
    >
      <Info className="text-info-500 h-12 w-12" aria-hidden="true" />
      <h3 className="text-text-primary text-lg leading-tight font-semibold">
        Este termo ja foi assinado
      </h3>
      <p className="text-text-secondary text-[15px]">
        Se precisar de uma copia, entre em contato com seu psicologo.
      </p>
    </div>
  );
}

function renderGeneralConsent(
  token: string,
  data: {
    termText: string;
    psychologistName: string;
    psychologistCrp: string;
  },
) {
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-text-primary text-[22px] leading-tight font-semibold">
          Termo de Consentimento Informado
        </h1>
        <p className="text-text-secondary mt-2 text-[15px]">
          Psicologo(a): {data.psychologistName} — CRP {data.psychologistCrp}
        </p>
      </div>

      <Card>
        <CardContent className="p-6 md:p-8">
          <div
            className="text-text-primary text-[17px] leading-[1.65] font-normal whitespace-pre-wrap"
            data-testid="consent-term-text"
          >
            {data.termText}
          </div>
        </CardContent>
      </Card>

      <ConsentSignForm token={token} signAction={signConsent} />
    </div>
  );
}

function renderAiConsent(
  token: string,
  data: {
    patientName: string;
    psychologistName: string;
    psychologistCrp: string;
    templateSnapshot: unknown;
    alreadySigned: boolean;
    expired: boolean;
  },
) {
  // Already signed
  if (data.alreadySigned) {
    return (
      <div
        className="flex flex-col items-center gap-3 py-16 text-center"
        data-testid="ai-consent-already-signed"
      >
        <Info className="text-info-500 h-12 w-12" aria-hidden="true" />
        <h3 className="text-text-primary text-lg leading-tight font-semibold">
          Este termo já foi assinado
        </h3>
        <p className="text-text-secondary text-[15px]">
          O consentimento para gravação e transcrição por IA já foi registrado.
        </p>
      </div>
    );
  }

  // Expired
  if (data.expired) {
    return (
      <div
        className="flex flex-col items-center gap-3 py-16 text-center"
        data-testid="ai-consent-expired"
      >
        <AlertCircle className="text-danger-500 h-12 w-12" aria-hidden="true" />
        <h3 className="text-text-primary text-lg leading-tight font-semibold">Link expirado</h3>
        <p className="text-text-secondary text-[15px]">
          Este termo expirou. Solicite um novo termo ao seu psicologo.
        </p>
      </div>
    );
  }

  // Validate template snapshot against Zod schema
  const parsed = AiConsentTemplateSchema.safeParse(data.templateSnapshot);

  if (!parsed.success) {
    return renderNotFound();
  }

  const template = parsed.data;

  // Replace placeholders in sections
  const processedSections = template.sections.map((section) => ({
    heading: section.heading,
    body: section.body
      .replace(/\{\{psychologistName\}\}/g, data.psychologistName)
      .replace(/\{\{psychologistCrp\}\}/g, data.psychologistCrp)
      .replace(/\{\{patientName\}\}/g, data.patientName),
  }));

  return (
    <AiConsentView
      token={token}
      title={template.title}
      sections={processedSections}
      psychologistName={data.psychologistName}
      psychologistCrp={data.psychologistCrp}
      patientName={data.patientName}
      signAction={signAiConsent}
    />
  );
}
