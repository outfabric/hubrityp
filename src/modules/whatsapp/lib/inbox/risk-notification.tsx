/**
 * In-app notification helpers for inbox messages.
 *
 * These functions use Sonner toast to display risk/info notifications
 * when messages arrive via Supabase Realtime or other push mechanisms.
 *
 * Design System Salvia:
 *   - Risk (risk_flag=true): border-left danger-500, AlertTriangle icon,
 *     autoDismiss=0 (persistent until manual dismiss)
 *   - Normal (risk_flag=false): border-left info-500, autoDismiss=4000
 */

import { AlertTriangle, MessageCircle } from 'lucide-react';
import { createElement } from 'react';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InboxNotificationPayload {
  patientId: string;
  patientName: string;
  riskFlag: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Shows a toast notification for an incoming inbox message.
 *
 * When `riskFlag` is true, the toast is persistent (no auto-dismiss),
 * styled with danger semantics, and includes a link to the conversation.
 *
 * When `riskFlag` is false, the toast auto-dismisses after 4s with
 * info semantics.
 */
export function showInboxNotification(payload: InboxNotificationPayload): void {
  const { patientId, patientName, riskFlag } = payload;

  if (riskFlag) {
    toast.error(`Mensagem com alerta de risco recebida de ${patientName}`, {
      description: 'Avalie pessoalmente',
      duration: Infinity,
      icon: createElement(AlertTriangle, {
        className: 'h-5 w-5 text-danger-500',
        'aria-hidden': 'true',
      }),
      action: {
        label: 'Ver conversa',
        onClick: () => {
          window.location.href = `/app/caixa-de-entrada?patient=${patientId}`;
        },
      },
      style: {
        borderLeft: '4px solid var(--color-danger-500)',
      },
    });
  } else {
    toast.info(`Nova mensagem de ${patientName}`, {
      duration: 4000,
      icon: createElement(MessageCircle, {
        className: 'h-5 w-5 text-info-500',
        'aria-hidden': 'true',
      }),
      style: {
        borderLeft: '4px solid var(--color-info-500)',
      },
    });
  }
}
