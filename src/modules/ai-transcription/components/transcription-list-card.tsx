import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import Link from 'next/link';

import type { TranscriptionListItem } from '@/modules/ai-transcription';
import { Card } from '@/shared/ui/card';

import { TranscriptionStatusBadge } from './transcription-status-badge';

// ---------------------------------------------------------------------------
// Template label map
// ---------------------------------------------------------------------------

/**
 * Human-readable labels for the therapeutic-approach templates. The stored
 * value is the raw enum slug; unknown / null values fall back to a neutral
 * dash so the card never renders an internal token.
 */
const TEMPLATE_LABELS: Record<string, string> = {
  tcc: 'TCC',
  psicanalise: 'Psicanálise',
  sistemica: 'Sistêmica',
  aba: 'ABA',
  livre: 'Livre',
};

function templateLabel(templateUsed: string | null): string {
  if (templateUsed === null) return '—';
  return TEMPLATE_LABELS[templateUsed] ?? templateUsed;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TranscriptionListCardProps {
  item: TranscriptionListItem;
}

/**
 * A single transcription row in the review list.
 *
 * Shows the patient's first name, the session date (or "Sem sessão vinculada"
 * when the transcription is not tied to a scheduled session), the template
 * label, the status badge, and a "Ver" link to the review page. The whole card
 * is wrapped in a link so the entire surface is the 44×44px tap target.
 *
 * Pure / presentational — safe to render in a Server Component.
 */
export function TranscriptionListCard({ item }: TranscriptionListCardProps) {
  const sessionDateLabel =
    item.sessionDate !== null
      ? format(item.sessionDate, "d 'de' MMMM 'de' yyyy", { locale: ptBR })
      : 'Sem sessão vinculada';

  return (
    <Link
      href={`/dashboard/transcricoes/${item.transcriptionId}`}
      className="focus-visible:ring-brand-500 block rounded-xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      data-testid="transcription-list-card-link"
      data-transcription-id={item.transcriptionId}
    >
      <Card className="hover:border-border-strong duration-fast flex items-center justify-between gap-4 p-4 transition-colors">
        <div className="min-w-0">
          <p className="text-text-primary truncate text-base font-medium">
            {item.patientFirstName}
          </p>
          <p className="text-text-secondary mt-0.5 text-sm">{sessionDateLabel}</p>
          <p className="text-text-tertiary mt-0.5 text-xs">{templateLabel(item.templateUsed)}</p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <TranscriptionStatusBadge status={item.status} />
          <span className="text-brand-700 text-sm font-medium">Ver</span>
        </div>
      </Card>
    </Link>
  );
}
