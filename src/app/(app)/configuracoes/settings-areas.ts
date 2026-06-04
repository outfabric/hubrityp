import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  BellRing,
  Calendar,
  HelpCircle,
  MapPin,
  MessageCircle,
  Sparkles,
} from 'lucide-react';

/**
 * Metadata for each top-level settings area, consumed by the settings index
 * page to render navigation cards. Order is intentional — it matches the
 * visual layout defined in the design spec.
 */

export interface SettingsArea {
  readonly label: string;
  readonly description: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly slug: string;
  /**
   * When true the area is rendered as a non-navigable, visually frozen card.
   * Derived at the render point from a feature flag (see configuracoes/page.tsx);
   * the static metadata never hardcodes it so the flag stays the single source.
   */
  readonly disabled?: boolean;
  /** When true a "Em breve" badge is shown on the frozen card. */
  readonly comingSoon?: boolean;
}

export const SETTINGS_AREAS: readonly SettingsArea[] = [
  {
    label: 'Locais de atendimento',
    description: 'Endereços e modalidades onde você atende presencial ou online.',
    href: '/configuracoes/locais',
    icon: MapPin,
    slug: 'locais',
  },
  {
    label: 'WhatsApp',
    description: 'Conecte sua conta do WhatsApp para enviar lembretes e mensagens.',
    href: '/configuracoes/integracoes/whatsapp',
    icon: MessageCircle,
    slug: 'whatsapp',
  },
  {
    label: 'Lembretes',
    description: 'Personalize quando e como avisar pacientes sobre suas sessões.',
    href: '/configuracoes/lembretes',
    icon: Bell,
    slug: 'lembretes',
  },
  {
    label: 'Agenda',
    description: 'Horários de trabalho, duração padrão e regras de agendamento.',
    href: '/configuracoes/agenda',
    icon: Calendar,
    slug: 'agenda',
  },
  {
    label: 'Transcrição IA',
    description:
      'Ativar a feature, escolher template padrão, sensibilidade de risco e ver estatísticas.',
    href: '/configuracoes/transcricao-ia',
    icon: Sparkles,
    slug: 'transcricao-ia',
  },
  {
    label: 'Notificações',
    description: 'Escolha quais avisos por e-mail e no app você quer receber.',
    href: '/configuracoes/notificacoes',
    icon: BellRing,
    slug: 'notificacoes',
  },
  {
    label: 'Ajuda',
    description: 'Revisite os primeiros passos de configuração do seu consultório.',
    href: '/configuracoes/ajuda/primeiros-passos',
    icon: HelpCircle,
    slug: 'ajuda',
  },
] as const;
