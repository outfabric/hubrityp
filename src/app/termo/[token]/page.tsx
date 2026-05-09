import { AlertCircle, Info } from 'lucide-react';

import { getConsentByTokenImpl } from '@/modules/patients';
import { ConsentSignForm } from '@/modules/patients/components/consent-sign-form';
import { Card, CardContent } from '@/shared/ui/card';

import { signConsent } from './actions';

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
 * This page is outside the `(app)` route group — no authentication required.
 * The signature token in the URL is the authorization credential (256 bits of
 * entropy). The middleware classifies `/termo` as `public` and passes through.
 *
 * Design system alignment:
 *   - bg `background` (from layout)
 *   - Max-width 720px centered (from layout)
 *   - Term text inside `Card default` (radius `xl`, padding `space-8` / `space-6` mobile)
 *   - Text in body-lg (17px/400, line-height 1.65)
 *   - Invalid token: `AlertCircle` icon in `danger-500` + h3
 *   - Already signed: `Info` icon in `info-500` + date message
 *   - Valid: renders term text + ConsentSignForm
 */
export default async function ConsentPage({ params }: ConsentPageProps) {
  const { token } = await params;
  const result = await getConsentByTokenImpl(token);

  // Invalid or revoked token
  if (!result.ok) {
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

  const { data } = result;

  // Already signed
  if (data.alreadySigned) {
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

  return (
    <div className="flex flex-col gap-6">
      {/* Term header */}
      <div className="text-center">
        <h1 className="text-text-primary text-[22px] leading-tight font-semibold">
          Termo de Consentimento Informado
        </h1>
        <p className="text-text-secondary mt-2 text-[15px]">
          Psicologo(a): {data.psychologistName} — CRP {data.psychologistCrp}
        </p>
      </div>

      {/* Term text in Card */}
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

      {/* Signing form */}
      <ConsentSignForm token={token} signAction={signConsent} />
    </div>
  );
}
