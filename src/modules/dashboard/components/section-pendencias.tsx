import { AlertCircle, FileText, Sparkles, User } from 'lucide-react';
import Link from 'next/link';

import type { PendenciasResult } from '@/modules/dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

/**
 * Seção "Pendências" — the three MVP-allowlisted pendência types.
 *
 * Pure presentational Server Component over the owner-scoped `PendenciasResult`.
 * It renders ONLY the three MVP rows (overdue evolutions, patients missing
 * consent, AI notes awaiting review) — post-MVP types (Receita Saúde, cobranças,
 * WhatsApp) are never queried by `getPendencias` and never referenced here, so
 * they cannot leak into the rendered output.
 *
 * Each row carries a count and a server-computed deep-link target. When every
 * count is zero, the section collapses to a discreet "Tudo em dia."
 */

export interface SectionPendenciasProps {
  result: PendenciasResult;
}

interface PendenciaRow {
  key: string;
  icon: typeof FileText;
  count: number;
  href: string;
  /** pt-BR label rendered as "{count} {label}". */
  label: (count: number) => string;
}

export function SectionPendencias({ result }: SectionPendenciasProps) {
  const rows: PendenciaRow[] = [
    {
      key: 'overdue-evolutions',
      icon: FileText,
      count: result.overdueEvolutionsCount,
      href: result.overdueEvolutionsHref,
      label: (n) => (n === 1 ? 'sessão sem evolução' : 'sessões sem evolução'),
    },
    {
      key: 'missing-consent',
      icon: User,
      count: result.patientsMissingConsentCount,
      href: result.patientsMissingConsentHref,
      label: (n) => (n === 1 ? 'paciente sem consentimento' : 'pacientes sem consentimento'),
    },
    {
      key: 'ai-review',
      icon: Sparkles,
      count: result.aiNotesAwaitingReviewCount,
      href: result.aiNotesAwaitingReviewHref,
      label: (n) => (n === 1 ? 'nota de IA para revisar' : 'notas de IA para revisar'),
    },
  ];

  const visibleRows = rows.filter((row) => row.count > 0);
  const allClear = visibleRows.length === 0;

  return (
    <Card data-testid="dashboard-section-pendencias" data-tour-anchor="secao-pendencias">
      <CardHeader className="flex-row items-center gap-2">
        <AlertCircle className="text-text-tertiary size-5" aria-hidden="true" />
        <CardTitle>Pendências</CardTitle>
      </CardHeader>
      <CardContent>
        {allClear ? (
          <p className="text-text-secondary text-sm" data-testid="dashboard-pendencias-clear">
            Tudo em dia.
          </p>
        ) : (
          <ul className="flex flex-col" data-testid="dashboard-pendencias-list">
            {visibleRows.map((row) => {
              const Icon = row.icon;
              return (
                <li
                  key={row.key}
                  className="border-border-subtle flex items-center justify-between gap-3 border-b py-3 last:border-b-0"
                  data-testid={`dashboard-pendencias-row-${row.key}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Icon className="text-text-tertiary size-4 shrink-0" aria-hidden="true" />
                    <span className="text-text-primary text-sm">
                      <span className="font-semibold">{row.count}</span> {row.label(row.count)}
                    </span>
                  </div>
                  <Link
                    href={row.href}
                    className="text-brand-700 inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline"
                    data-testid={`dashboard-pendencias-link-${row.key}`}
                  >
                    Ver
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
