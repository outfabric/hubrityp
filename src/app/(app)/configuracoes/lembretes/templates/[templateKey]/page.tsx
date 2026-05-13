import { redirect } from 'next/navigation';

import { TemplateEditForm } from '@/modules/whatsapp/components/template-edit-form';
import { TEMPLATE_LABELS } from '@/modules/whatsapp/lib/template-labels';

import { getTemplate } from './actions';

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
    <>
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
    </>
  );
}
