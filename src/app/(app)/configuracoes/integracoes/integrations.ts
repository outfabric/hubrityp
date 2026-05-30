import type { LucideIcon } from 'lucide-react';
import { MessageCircle } from 'lucide-react';

/**
 * Metadata for each integration available to the psychologist.
 * v1 ships with WhatsApp only; additional entries will be added as
 * integrations are built (e.g. Google Calendar, Asaas).
 */

export interface Integration {
  readonly label: string;
  readonly description: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly slug: string;
  /**
   * When true the integration is rendered as a non-navigable, visually frozen
   * card. Derived at the render point from a feature flag (see
   * integracoes/page.tsx); the static metadata never hardcodes it.
   */
  readonly disabled?: boolean;
  /** When true a "Em breve" badge is shown on the frozen card. */
  readonly comingSoon?: boolean;
}

export const INTEGRATIONS: readonly Integration[] = [
  {
    label: 'WhatsApp',
    description: 'Conecte sua conta para enviar lembretes e mensagens.',
    href: '/configuracoes/integracoes/whatsapp',
    icon: MessageCircle,
    slug: 'whatsapp',
  },
] as const;
