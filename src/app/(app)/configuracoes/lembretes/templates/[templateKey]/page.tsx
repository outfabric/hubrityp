import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { TemplateEditForm } from '@/modules/whatsapp/components/template-edit-form';

import { getTemplate } from './actions';

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
// Page component
// ---------------------------------------------------------------------------

interface TemplateEditPageProps {
  params: Promise<{ templateKey: string }>;
}

export default async function TemplateEditPage({ params }: TemplateEditPageProps) {
  const { templateKey } = await params;

  const result = await getTemplate(templateKey);

  if (!result.ok) {
    redirect('/configuracoes/lembretes/templates');
  }

  const label = TEMPLATE_LABELS[result.template.templateKey] ?? result.template.templateKey;

  return (
    <div className="mx-auto max-w-[1200px]">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-4" data-testid="template-edit-breadcrumb">
        <ol className="text-text-tertiary flex items-center gap-1 text-[13px]">
          <li>
            <Link
              href="/configuracoes"
              className="hover:text-text-primary duration-fast transition-colors"
            >
              Configurações
            </Link>
          </li>
          <li>
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </li>
          <li>
            <Link
              href="/configuracoes/lembretes/templates"
              className="hover:text-text-primary duration-fast transition-colors"
            >
              Lembretes
            </Link>
          </li>
          <li>
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </li>
          <li>
            <Link
              href="/configuracoes/lembretes/templates"
              className="hover:text-text-primary duration-fast transition-colors"
            >
              Templates
            </Link>
          </li>
          <li>
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </li>
          <li aria-current="page" className="text-text-primary font-medium">
            {label}
          </li>
        </ol>
      </nav>

      {/* Page title */}
      <h1
        className="text-text-primary mb-8 text-[28px] leading-[1.25] font-semibold"
        data-testid="template-edit-title"
      >
        {label}
      </h1>

      {/* Edit form (Client Component) */}
      <TemplateEditForm
        templateKey={result.template.templateKey}
        initialBody={result.template.body}
      />
    </div>
  );
}
