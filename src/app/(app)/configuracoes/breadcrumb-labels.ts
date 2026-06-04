/**
 * Static mapping from URL path segments to human-readable breadcrumb labels.
 * Used by the settings layout breadcrumb component to resolve each segment
 * without a database lookup.
 */
export const BREADCRUMB_LABELS: Record<string, string> = {
  configuracoes: 'Configurações',
  locais: 'Locais de atendimento',
  integracoes: 'Integrações',
  whatsapp: 'WhatsApp',
  lembretes: 'Lembretes',
  templates: 'Templates',
  historico: 'Histórico',
  agenda: 'Agenda',
  'transcricao-ia': 'Transcrição IA',
  notificacoes: 'Notificações',
  ajuda: 'Ajuda',
  'primeiros-passos': 'Primeiros passos',
};
