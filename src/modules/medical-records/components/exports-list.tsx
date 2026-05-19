'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AlertTriangle, Download, FileDown, Loader2, Timer } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { ExportSummary, GetExportSignedUrlResult } from '@/modules/medical-records';
import type { ExportFilters } from '@/modules/medical-records/lib/exports';
import { createBrowserClient } from '@/shared/supabase/client';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ExportsListProps {
  initial: ExportSummary[];
  patientId: string;
  /** Current user id — used to filter the Realtime channel + client-side guard. */
  userId: string;
  /** Server Action: get a signed download URL for a completed export. */
  getExportSignedUrl: (input: { exportId: string }) => Promise<GetExportSignedUrlResult>;
}

// ---------------------------------------------------------------------------
// Status UI configuration
// ---------------------------------------------------------------------------

type ExportStatus = 'pending' | 'processing' | 'ready' | 'expired' | 'failed';

const STATUS_CONFIG: Record<
  ExportStatus,
  { label: string; variant: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }
> = {
  pending: { label: 'Em processamento', variant: 'info' },
  processing: { label: 'Em processamento', variant: 'info' },
  ready: { label: 'Pronto', variant: 'success' },
  expired: { label: 'Expirado', variant: 'warning' },
  failed: { label: 'Falhou', variant: 'danger' },
};

// ---------------------------------------------------------------------------
// Section label mapping (for filter badges)
// ---------------------------------------------------------------------------

const SECTION_LABELS: Record<string, string> = {
  anamnese: 'Anamnese',
  evolucoes: 'Evolucoes',
  hipoteses: 'Hipoteses',
  planoTerapeutico: 'Plano terapeutico',
  escalas: 'Escalas',
  documentos: 'Documentos',
  anexosIndex: 'Indice de anexos',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

function formatFileSize(bytes: number | null): string | null {
  if (bytes === null || bytes === undefined) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Computes the effective status, accounting for exports whose `expires_at`
 * has passed but whose status column hasn't been updated by the cron yet.
 */
function effectiveStatus(exp: ExportSummary): ExportStatus {
  if (exp.status === 'ready' && isExpired(exp.expiresAt)) {
    return 'expired';
  }
  const known: ExportStatus[] = ['pending', 'processing', 'ready', 'expired', 'failed'];
  if (known.includes(exp.status as ExportStatus)) {
    return exp.status as ExportStatus;
  }
  // Fallback for unexpected status values
  return 'pending';
}

function buildFilterBadges(filters: unknown): string[] {
  if (!filters || typeof filters !== 'object') return [];
  const f = filters as Partial<ExportFilters>;
  const badges: string[] = [];

  // Date range
  if (f.dateRange?.from || f.dateRange?.to) {
    const from = f.dateRange.from
      ? format(new Date(f.dateRange.from), 'MMM yyyy', { locale: ptBR })
      : '';
    const to = f.dateRange.to ? format(new Date(f.dateRange.to), 'MMM yyyy', { locale: ptBR }) : '';
    if (from && to) {
      badges.push(`Periodo: ${from} - ${to}`);
    } else if (from) {
      badges.push(`A partir de ${from}`);
    } else if (to) {
      badges.push(`Ate ${to}`);
    }
  }

  // Excluded sections
  if (f.sections) {
    const excluded = Object.entries(f.sections)
      .filter(([, v]) => v === false)
      .map(([k]) => SECTION_LABELS[k] ?? k);
    if (excluded.length > 0 && excluded.length < Object.keys(SECTION_LABELS).length) {
      badges.push(`Sem: ${excluded.join(', ')}`);
    } else if (excluded.length === Object.keys(SECTION_LABELS).length) {
      badges.push('Sem secoes');
    }
  }

  // Personal notes
  if (f.includePersonalNotes) {
    badges.push('Inclui notas pessoais');
  }

  return badges;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Client component that renders the list of prontuario exports with real-time
 * status updates via Supabase Realtime.
 *
 * Subscribes to postgres_changes on `prontuario_exports` filtered by
 * `patient_id` (single-column Realtime filter limitation). RLS enforces
 * user_id ownership server-side; client-side guard on user_id provides
 * defense-in-depth.
 */
export function ExportsList({ initial, patientId, userId, getExportSignedUrl }: ExportsListProps) {
  const [exports, setExports] = useState<ExportSummary[]>(initial);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Keep a ref to track previous statuses for toast deduplication
  const statusMapRef = useRef<Map<string, string>>(new Map());

  // Initialize the status map from the initial data
  useEffect(() => {
    const map = new Map<string, string>();
    for (const exp of initial) {
      map.set(exp.id, exp.status);
    }
    statusMapRef.current = map;
  }, [initial]);

  // Supabase browser client — memoized to avoid re-creating on every render
  const supabase = useMemo(() => createBrowserClient(), []);

  // ----- Realtime subscription -----
  useEffect(() => {
    const channel = supabase
      .channel(`exports:${patientId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'prontuario_exports',
          filter: `patient_id=eq.${patientId}`,
        },
        (payload) => {
          const newRow = payload.new as Record<string, unknown>;

          // Defense-in-depth: skip rows from other users (RLS should
          // prevent this, but verify client-side as well)
          if (newRow.user_id !== userId) return;

          const mapped = mapRealtimeRow(newRow);
          setExports((prev) => {
            // Avoid duplicates (in case the INSERT arrives after SSR fetch)
            if (prev.some((e) => e.id === mapped.id)) return prev;
            return [mapped, ...prev];
          });

          // Track status for toast deduplication
          statusMapRef.current.set(mapped.id, mapped.status);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'prontuario_exports',
          filter: `patient_id=eq.${patientId}`,
        },
        (payload) => {
          const updatedRow = payload.new as Record<string, unknown>;

          // Defense-in-depth: skip rows from other users
          if (updatedRow.user_id !== userId) return;

          const mapped = mapRealtimeRow(updatedRow);
          const previousStatus = statusMapRef.current.get(mapped.id);

          // Update the exports list in place
          setExports((prev) => prev.map((e) => (e.id === mapped.id ? mapped : e)));

          // Toast on meaningful status transitions only
          if (previousStatus !== mapped.status) {
            if (mapped.status === 'ready' && previousStatus !== 'ready') {
              toast.success('Exportacao pronta. Clique para baixar.');
            } else if (mapped.status === 'failed') {
              toast.error('Exportacao falhou. Tente novamente.');
            }
          }

          // Update tracked status
          statusMapRef.current.set(mapped.id, mapped.status);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, patientId, userId]);

  // ----- Download handler -----
  const handleDownload = useCallback(
    async (exportId: string) => {
      setDownloadingId(exportId);
      try {
        const result = await getExportSignedUrl({ exportId });

        if (result.ok) {
          window.open(result.signedUrl, '_blank', 'noopener,noreferrer');
        } else {
          const messages: Record<string, string> = {
            NOT_READY: 'PDF ainda esta sendo gerado. Tente novamente em instantes.',
            EXPIRED: 'Esta exportacao expirou. Solicite uma nova.',
            NOT_FOUND: 'Exportacao nao encontrada.',
            STORAGE_ERROR: 'Erro ao acessar o arquivo. Tente novamente.',
          };
          toast.error(messages[result.code] ?? 'Erro ao obter PDF. Tente novamente.');
        }
      } catch {
        toast.error('Erro ao obter PDF. Tente novamente.');
      } finally {
        setDownloadingId(null);
      }
    },
    [getExportSignedUrl],
  );

  // ----- Empty state (7.3) -----
  if (exports.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 text-center"
        data-testid="exports-empty-state"
      >
        <Download className="text-text-tertiary mb-3 h-10 w-10" aria-hidden="true" />
        <h4 className="text-text-primary mb-1 text-lg font-semibold">Nenhuma exportacao ainda</h4>
        <p className="text-text-secondary mb-4 max-w-sm text-sm">
          Use o botao &quot;Exportar prontuario&quot; para gerar um PDF completo.
        </p>
      </div>
    );
  }

  // ----- List of exports -----
  return (
    <div className="space-y-3" data-testid="exports-list" role="list" aria-label="Exportacoes">
      {exports.map((exp) => {
        const status = effectiveStatus(exp);
        const config = STATUS_CONFIG[status];
        const filterBadges = buildFilterBadges(exp.filters);
        const fileSize = formatFileSize(exp.fileSize);
        const createdFormatted = format(new Date(exp.createdAt), "dd/MM/yyyy 'as' HH:mm", {
          locale: ptBR,
        });

        return (
          <Card
            key={exp.id}
            className="p-6"
            data-testid={`export-card-${exp.id}`}
            role="listitem"
            aria-label={`Exportacao de ${createdFormatted}`}
          >
            <div className="flex items-start justify-between gap-3">
              {/* Left: info */}
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <FileDown className="text-text-tertiary h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="text-text-primary text-sm font-medium">
                    Solicitado em {createdFormatted}
                  </span>
                </div>

                {/* Filter summary badges */}
                {filterBadges.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {filterBadges.map((label) => (
                      <Badge key={label} variant="neutral">
                        {label}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* File size (when ready) */}
                {status === 'ready' && fileSize && (
                  <p className="text-text-tertiary mt-1 text-xs">{fileSize}</p>
                )}
              </div>

              {/* Right: status badge + action */}
              <div className="flex items-center gap-2">
                <Badge variant={config.variant}>{config.label}</Badge>

                {/* Pending / Processing: spinner */}
                {(status === 'pending' || status === 'processing') && (
                  <div role="status" aria-label="Em processamento">
                    <Loader2
                      className="text-text-tertiary h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    <span className="sr-only">Em processamento</span>
                  </div>
                )}

                {/* Ready: download button */}
                {status === 'ready' && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => void handleDownload(exp.id)}
                    disabled={downloadingId === exp.id}
                    data-testid={`export-download-${exp.id}`}
                    aria-label="Baixar exportacao em PDF"
                  >
                    {downloadingId === exp.id ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Baixar
                  </Button>
                )}

                {/* Expired: disabled download */}
                {status === 'expired' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled
                    data-testid={`export-expired-${exp.id}`}
                    aria-label="Exportacao expirada"
                  >
                    <Timer className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    Expirado
                  </Button>
                )}

                {/* Failed: retry link (navigates to the prontuario page
                    where the user can re-open the Export Modal) */}
                {status === 'failed' && (
                  <Button variant="ghost" size="sm" asChild data-testid={`export-retry-${exp.id}`}>
                    <Link href={`/pacientes/${exp.patientId}/prontuario`}>
                      <AlertTriangle className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                      Solicitar novamente
                    </Link>
                  </Button>
                )}

                {/* Fallback for unknown status values — effectiveStatus()
                    normalizes unknowns to 'pending', but this guard prevents
                    a blank action area if the mapping ever drifts. */}
                {!(['pending', 'processing', 'ready', 'expired', 'failed'] as string[]).includes(
                  status,
                ) && <Badge variant="neutral">Status desconhecido</Badge>}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Realtime row mapper — converts the raw Realtime payload to ExportSummary
// ---------------------------------------------------------------------------

/**
 * Maps a raw Realtime payload row (snake_case, string dates) to the
 * ExportSummary shape used by the component. Realtime payloads contain
 * the full row as a flat key-value object.
 */
function mapRealtimeRow(row: Record<string, unknown>): ExportSummary {
  return {
    id: row.id as string,
    patientId: row.patient_id as string,
    patientName: '', // Realtime payload doesn't include the join — name not critical for the card
    status: row.status as string,
    filters: row.filters,
    fileSize: row.file_size != null ? Number(row.file_size) : null,
    createdAt: new Date(row.created_at as string),
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
  };
}
