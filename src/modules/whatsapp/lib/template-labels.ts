/**
 * Maps template_key → human-readable PT-BR label.
 *
 * Single source of truth consumed by both the template listing cards and the
 * template edit page breadcrumb/title.
 */
export const TEMPLATE_LABELS: Record<string, string> = {
  lembrete_24h: 'Lembrete 24h',
  lembrete_2h: 'Lembrete 2h',
  cancelamento_aviso: 'Aviso de cancelamento',
  link_video: 'Link de vídeo',
  termo_consentimento: 'Termo de consentimento',
};
