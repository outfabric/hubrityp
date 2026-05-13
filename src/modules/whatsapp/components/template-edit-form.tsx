'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { updateTemplate } from '@/app/(app)/configuracoes/lembretes/templates/[templateKey]/actions';
import type { TemplateInput, TemplateKey } from '@/modules/whatsapp';
import { renderTemplate, TEMPLATE_VARIABLES, templateInputSchema } from '@/modules/whatsapp';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/shared/ui/form';
import { Textarea } from '@/shared/ui/textarea';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BODY_LENGTH = 1024;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an example-values map from TEMPLATE_VARIABLES for live preview.
 * Uses the `example` field from each variable entry.
 */
function buildExampleVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const v of TEMPLATE_VARIABLES) {
    vars[v.key] = v.example;
  }
  return vars;
}

const EXAMPLE_VARS = buildExampleVars();

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TemplateEditFormProps {
  templateKey: string;
  initialBody: string;
}

export function TemplateEditForm({ templateKey, initialBody }: TemplateEditFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const form = useForm<TemplateInput>({
    resolver: zodResolver(templateInputSchema),
    defaultValues: {
      body: initialBody,
      template_key: templateKey as TemplateKey,
    },
    mode: 'onBlur',
  });

  const watchedBody = form.watch('body');
  const bodyLength = watchedBody?.length ?? 0;

  // Filter variables applicable to this template key
  const applicableVariables = useMemo(
    () =>
      TEMPLATE_VARIABLES.filter((v) =>
        (v.applicableTemplates as readonly string[]).includes(templateKey),
      ),
    [templateKey],
  );

  // Live preview: render template with example values, catch errors
  // gracefully during partial editing
  const previewText = useMemo(() => {
    if (!watchedBody) return '';
    try {
      return renderTemplate({ body: watchedBody, vars: EXAMPLE_VARS });
    } catch {
      // During editing the template may have incomplete variables —
      // show the raw body as fallback
      return watchedBody;
    }
  }, [watchedBody]);

  // Insert a variable at cursor position in the textarea
  const insertVariable = useCallback(
    (variableKey: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const insertion = `{${variableKey}}`;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const currentValue = form.getValues('body');

      const newValue = currentValue.slice(0, start) + insertion + currentValue.slice(end);

      form.setValue('body', newValue, {
        shouldValidate: false,
        shouldDirty: true,
      });

      // Restore cursor position after the inserted variable
      requestAnimationFrame(() => {
        const newCursorPos = start + insertion.length;
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      });
    },
    [form],
  );

  // Submit handler
  function onSubmit(data: TemplateInput) {
    startTransition(async () => {
      const result = await updateTemplate(data);

      if (!result.ok) {
        if (result.error === 'invalid_input') {
          // Map field errors back to the form
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            if (messages.length > 0) {
              form.setError(field as keyof TemplateInput, {
                message: messages[0],
              });
            }
          }
          return;
        }

        toast.error('Erro ao salvar template. Tente novamente.');
        return;
      }

      toast.success('Template salvo e enviado para aprovação do WhatsApp.');
      router.push('/configuracoes/lembretes/templates');
    });
  }

  return (
    <Form {...form}>
      <form
        onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
        className="grid grid-cols-1 gap-8 md:grid-cols-2"
        data-testid="template-edit-form"
      >
        {/* Left column — Editor */}
        <Card className="p-6" data-testid="template-editor-card">
          <CardContent className="flex flex-col gap-6 p-0">
            <h3 className="text-text-primary text-[18px] leading-[1.25] font-semibold">
              Texto da mensagem
            </h3>

            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Corpo do template</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      ref={(el) => {
                        // Merge refs: RHF field ref + our local ref
                        field.ref(el);
                        textareaRef.current = el;
                      }}
                      rows={8}
                      placeholder="Digite o texto do template..."
                      data-testid="template-body-textarea"
                    />
                  </FormControl>

                  {/* Char counter + inline error */}
                  <div className="flex items-center justify-between">
                    <div>
                      {form.formState.errors.body && (
                        <p
                          className="text-danger-700 flex items-center gap-1 text-sm"
                          role="alert"
                          data-testid="template-body-error"
                        >
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          {form.formState.errors.body.message}
                        </p>
                      )}
                    </div>
                    <span
                      className="text-text-tertiary text-[12px] font-medium"
                      data-testid="template-char-counter"
                    >
                      {bodyLength} / {MAX_BODY_LENGTH}
                    </span>
                  </div>
                </FormItem>
              )}
            />

            {/* Warning alert about re-approval */}
            <Alert variant="warning" data-testid="template-reapproval-alert">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Após salvar, o texto será re-submetido ao WhatsApp e ficará em análise por até 24h.
              </AlertDescription>
            </Alert>

            {/* Action buttons */}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.push('/configuracoes/lembretes/templates')}
                disabled={isPending}
                data-testid="template-cancel-button"
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending} data-testid="template-submit-button">
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Salvando...
                  </>
                ) : (
                  'Salvar e enviar para aprovação'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Right column — Variables + Preview */}
        <div className="flex flex-col gap-8">
          {/* Variables panel */}
          <Card
            className="border-border bg-surface p-6 shadow-none"
            data-testid="template-variables-card"
          >
            <CardContent className="flex flex-col gap-4 p-0">
              <h3 className="text-text-primary text-[18px] leading-[1.25] font-semibold">
                Variáveis disponíveis
              </h3>
              <div className="flex flex-wrap gap-2">
                {applicableVariables.map((variable) => (
                  <button
                    key={variable.key}
                    type="button"
                    onClick={() => insertVariable(variable.key)}
                    className="cursor-pointer"
                    aria-label={`Inserir variável ${variable.label}`}
                    data-testid={`variable-badge-${variable.key}`}
                  >
                    <Badge className="bg-brand-100 text-brand-700 hover:bg-brand-200 duration-fast transition-colors">
                      {`{${variable.key}}`}
                    </Badge>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Live preview */}
          <Card
            className="border-border bg-surface p-6 shadow-none"
            data-testid="template-preview-card"
          >
            <CardContent className="flex flex-col gap-4 p-0">
              <h3 className="text-text-primary text-[18px] leading-[1.25] font-semibold">
                Pré-visualização
              </h3>
              <div
                className="bg-surface-muted text-text-primary rounded-lg p-4 text-[15px] whitespace-pre-wrap"
                data-testid="template-preview-text"
              >
                {previewText || (
                  <span className="text-text-tertiary italic">
                    Digite o texto acima para ver a pré-visualização...
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </form>
    </Form>
  );
}
