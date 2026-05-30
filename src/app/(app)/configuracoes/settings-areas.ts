import type { LucideIcon } from 'lucide-react';
import { Bell, Calendar, MapPin, MessageCircle, Sparkles } from 'lucide-react';

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
] as const;
