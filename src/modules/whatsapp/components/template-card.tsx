'use client';

import { Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';

import type { TemplatePreview } from '@/modules/whatsapp';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardFooter } from '@/shared/ui/card';

// ---------------------------------------------------------------------------
// Label mapping — template_key → human-readable PT-BR name
// ---------------------------------------------------------------------------

const TEMPLATE_LABELS: Record<string, string> = {
  lembrete_24h: 'Lembrete 24h',
  lembrete_2h: 'Lembrete 2h',
  confirmacao_recebida: 'Confirmação recebida',
  cancelamento_aviso: 'Aviso de cancelamento',
  link_video: 'Link de vídeo',
  termo_consentimento: 'Termo de consentimento',
};

// ---------------------------------------------------------------------------
// Badge variant mapping — meta_status → Badge variant + label
// ---------------------------------------------------------------------------

type BadgeConfig = {
  variant: 'success' | 'warning' | 'danger';
  label: string;
};

const STATUS_BADGE: Record<string, BadgeConfig> = {
  approved: { variant: 'success', label: 'Aprovado' },
  pending: { variant: 'warning', label: 'Em análise' },
  rejected: { variant: 'danger', label: 'Rejeitado' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TemplateCardProps {
  template: TemplatePreview;
}

export function TemplateCard({ template }: TemplateCardProps) {
  const router = useRouter();

  const label = TEMPLATE_LABELS[template.templateKey] ?? template.templateKey;
  const badgeConfig = template.metaStatus
    ? STATUS_BADGE[template.metaStatus]
    : null;

  const href = `/configuracoes/lembretes/templates/${template.templateKey}`;

  function handleCardClick() {
    router.push(href);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      router.push(href);
    }
  }

  return (
    <Card
      className="hover:border-border-strong flex cursor-pointer flex-col transition-colors duration-fast"
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      role="link"
      tabIndex={0}
      aria-label={`Template ${label}`}
      data-testid={`template-card-${template.templateKey}`}
    >
      <CardContent className="flex flex-col gap-3 pt-6">
        <h4 className="text-text-primary text-[16px] leading-[1.25] font-medium">
          {label}
        </h4>

        <p className="text-text-secondary line-clamp-2 text-[13px]">
          {template.body}
        </p>

        {badgeConfig && (
          <Badge variant={badgeConfig.variant} data-testid="template-meta-status-badge">
            {badgeConfig.label}
          </Badge>
        )}
      </CardContent>

      <CardFooter className="mt-auto justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            // Prevent double-navigation from card click
            e.stopPropagation();
            router.push(href);
          }}
          aria-label={`Editar template ${label}`}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Editar
        </Button>
      </CardFooter>
    </Card>
  );
}
