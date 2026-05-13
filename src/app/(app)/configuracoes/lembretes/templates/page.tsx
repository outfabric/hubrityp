import { MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';

import { TemplateCard } from '@/modules/whatsapp/components/template-card';
import { Button } from '@/shared/ui/button';

import { listTemplates } from './actions';

// ---------------------------------------------------------------------------
// Inner async component that fetches data
// ---------------------------------------------------------------------------

async function TemplatesListServer() {
  const result = await listTemplates();

  if (!result.ok) {
    return (
      <div className="text-text-secondary py-12 text-center">
        Erro ao carregar templates. Tente novamente.
      </div>
    );
  }

  if (result.templates.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 py-12"
        data-testid="templates-empty-state"
      >
        <MessageCircle className="text-text-tertiary h-6 w-6" aria-hidden="true" />
        <h4 className="text-text-primary text-[16px] leading-[1.25] font-medium">
          Nenhum template encontrado
        </h4>
        <p className="text-text-secondary text-center text-[15px]">
          Conecte seu WhatsApp para criar os templates de mensagem.
        </p>
        <Button asChild>
          <Link href="/configuracoes/integracoes/whatsapp">Conectar WhatsApp</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {result.templates.map((template) => (
        <TemplateCard key={template.id} template={template} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function TemplatesPage() {
  return (
    <>
      <div className="mb-6">
        <h1
          className="text-text-primary text-[28px] leading-[1.25] font-semibold"
          data-testid="templates-page-title"
        >
          Templates de Mensagem
        </h1>
        <p className="text-text-secondary mt-2 text-[15px]">
          Edite os modelos de mensagem enviados aos pacientes. Alterações precisam ser aprovadas
          pelo WhatsApp.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        }
      >
        <TemplatesListServer />
      </Suspense>
    </>
  );
}
