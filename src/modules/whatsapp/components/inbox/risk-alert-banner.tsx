import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription } from '@/shared/ui/alert';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RiskAlertBannerProps {
  /** Whether to display the banner. Only shown when the conversation has risk. */
  hasRisk: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Risk alert banner shown above the conversation thread when the
 * conversation contains messages flagged as risk-related.
 *
 * Uses the Salvia Alert danger variant:
 * - bg danger-50
 * - border-left danger-500 4px
 * - icon AlertTriangle 24px
 * - text danger-700
 *
 * aria-live="assertive" ensures screen readers announce the banner
 * immediately when it appears.
 */
export function RiskAlertBanner({ hasRisk }: RiskAlertBannerProps) {
  if (!hasRisk) {
    return null;
  }

  return (
    <Alert variant="danger" className="border-danger-500 border-l-4" aria-live="assertive">
      <AlertTriangle size={24} />
      <AlertDescription>
        Mensagem com conteúdo de risco detectado. Atenção: avalie pessoalmente. O sistema NÃO
        substitui escuta clínica.{' '}
        <a href="#" className="text-danger-700 underline-offset-2 hover:underline">
          Saiba mais
        </a>
      </AlertDescription>
    </Alert>
  );
}
