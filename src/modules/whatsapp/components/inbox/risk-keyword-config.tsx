'use client';

import { Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Textarea } from '@/shared/ui/textarea';

// ---------------------------------------------------------------------------
// Default risk keywords — same list as detect-risk-keywords.ts
// ---------------------------------------------------------------------------

const DEFAULT_RISK_KEYWORDS = [
  'suicidio',
  'suicidar',
  'me matar',
  'acabar com tudo',
  'autolesao',
  'me cortar',
  'sumir pra sempre',
  'nao quero mais viver',
  'quero morrer',
  'tirar minha vida',
  'desistir de tudo',
  'nao aguento mais',
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RiskKeywordConfigProps {
  /** Initial keywords loaded from the server (one per line). Falls back to defaults. */
  initialKeywords?: string[];
  /** Server action to persist the keywords. Receives the array of keywords. */
  onSave?: (keywords: string[]) => Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Client component for configuring risk detection keywords.
 *
 * Design System Salvia:
 *   - Card default (border, radius xl, padding space-6)
 *   - h3 title (18px/600)
 *   - shadcn Textarea (10 rows, border, radius md, bg surface-sunken)
 *   - Helper text body-sm (13px/400) text-tertiary
 *   - Button primary "Salvar" with loading state
 *   - Toast success on save
 */
export function RiskKeywordConfig({ initialKeywords, onSave }: RiskKeywordConfigProps) {
  const keywords = initialKeywords ?? DEFAULT_RISK_KEYWORDS;
  const [value, setValue] = useState(keywords.join('\n'));
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const parsed = value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    startTransition(async () => {
      if (onSave) {
        const result = await onSave(parsed);
        if (result.ok) {
          toast.success('Palavras-chave atualizadas');
        } else {
          toast.error('Erro ao salvar palavras-chave. Tente novamente.');
        }
      } else {
        // No server action provided — optimistic local-only save
        toast.success('Palavras-chave atualizadas');
      }
    });
  }

  return (
    <Card data-testid="risk-keyword-config">
      <CardContent className="p-4 md:p-6">
        <div className="space-y-4">
          <h3
            className="text-text-primary text-[18px] leading-[1.25] font-semibold"
            data-testid="risk-keyword-config-title"
          >
            Palavras-chave de risco
          </h3>

          <div className="space-y-2">
            <Textarea
              rows={10}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Uma palavra-chave por linha"
              data-testid="risk-keyword-textarea"
              aria-label="Palavras-chave de risco, uma por linha"
            />
            <p className="text-text-tertiary text-[13px]">
              Heuristica — nunca substitui escuta clinica.
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              disabled={isPending}
              onClick={handleSave}
              data-testid="risk-keyword-save"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Salvando...
                </>
              ) : (
                'Salvar'
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
