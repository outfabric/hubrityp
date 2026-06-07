'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarIcon, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useCallback, useMemo, useState, useTransition } from 'react';
import type { DateRange } from 'react-day-picker';

import type {
  AnalyticsSummary,
  AnalyticsSummaryInput,
  GetAnalyticsSummaryResult,
  SearchMessageHistoryResult,
  SearchResultItem,
} from '@/modules/whatsapp';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Calendar } from '@/shared/ui/calendar';
import { Card, CardContent } from '@/shared/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function formatPercentage(numerator: number, denominator: number): string {
  if (denominator === 0) return '0%';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'dd/MM HH:mm', { locale: ptBR });
}

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

type PeriodKey = 'current_month' | 'previous_month' | 'last_90_days' | 'custom';

interface PeriodRange {
  dateFrom: Date;
  dateTo: Date;
}

function getPeriodRange(key: Exclude<PeriodKey, 'custom'>): PeriodRange {
  const now = new Date();

  switch (key) {
    case 'current_month':
      return {
        dateFrom: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        dateTo: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999)),
      };
    case 'previous_month':
      return {
        dateFrom: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
        dateTo: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999)),
      };
    case 'last_90_days': {
      const dateTo = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
      );
      const dateFrom = new Date(dateTo);
      dateFrom.setUTCDate(dateFrom.getUTCDate() - 90);
      dateFrom.setUTCHours(0, 0, 0, 0);
      return { dateFrom, dateTo };
    }
  }
}

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

function statusToBadge(status: string | null): {
  label: string;
  variant: 'neutral' | 'info' | 'success' | 'danger';
} {
  switch (status) {
    case 'sent':
    case 'queued':
      return { label: 'Enviada', variant: 'neutral' };
    case 'delivered':
      return { label: 'Entregue', variant: 'info' };
    case 'read':
      return { label: 'Lida', variant: 'success' };
    case 'failed':
    case 'unable_to_send':
      return { label: 'Falhou', variant: 'danger' };
    default:
      return { label: status ?? 'Desconhecido', variant: 'neutral' };
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AnalyticsDashboardProps {
  initialData: AnalyticsSummary;
  getAnalyticsSummary: (input: AnalyticsSummaryInput) => Promise<GetAnalyticsSummaryResult>;
  searchMessageHistory: (input: unknown) => Promise<SearchMessageHistoryResult>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Client component for the analytics dashboard.
 *
 * Design System Salvia:
 *   - Grid 4 cols desktop / 2 cols mobile, gap space-6
 *   - Card flat (border, radius xl, padding space-6)
 *   - Labels in caption-upper (12px/500, tracking 0.06em, uppercase, text-tertiary)
 *   - Values in h2 (22px/600)
 *   - Select for period filter
 *   - Popover + Calendar for custom range
 *   - Table with semantic badges; mobile stacked cards
 *   - Pagination at bottom
 */
export function AnalyticsDashboard({
  initialData,
  getAnalyticsSummary,
  searchMessageHistory,
}: AnalyticsDashboardProps) {
  const [data, setData] = useState<AnalyticsSummary>(initialData);
  const [period, setPeriod] = useState<PeriodKey>('current_month');
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [isPending, startTransition] = useTransition();

  // Message history table state
  const [messages, setMessages] = useState<SearchResultItem[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoadingMessages, startMessageTransition] = useTransition();
  const pageSize = 20;

  // Memoize current period range for re-use
  const currentPeriodRange: PeriodRange | null = useMemo(() => {
    if (period === 'custom') {
      if (customRange?.from && customRange?.to) {
        return { dateFrom: customRange.from, dateTo: customRange.to };
      }
      return null;
    }
    return getPeriodRange(period);
  }, [period, customRange]);

  // Load analytics data for a given period
  const loadAnalytics = useCallback((range: PeriodRange) => {
    startTransition(async () => {
      const result = await getAnalyticsSummary({
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
      });
      if (result.ok) {
        setData(result.data);
      }
    });
  }, []);

  // Load message history for the current period
  const loadMessages = useCallback((range: PeriodRange, page: number) => {
    startMessageTransition(async () => {
      const result = await searchMessageHistory({
        dateRange: {
          from: range.dateFrom.toISOString().split('T')[0],
          to: range.dateTo.toISOString().split('T')[0],
        },
        page,
        pageSize,
      });
      if (result.ok) {
        setMessages(result.results);
        setTotalMessages(result.total);
        setCurrentPage(result.page);
      }
    });
  }, []);

  // Handle period change
  function handlePeriodChange(value: string) {
    const key = value as PeriodKey;
    setPeriod(key);

    if (key !== 'custom') {
      const range = getPeriodRange(key);
      loadAnalytics(range);
      loadMessages(range, 1);
    }
  }

  // Handle custom range selection
  function handleCustomRangeSelect(range: DateRange | undefined) {
    setCustomRange(range);
    if (range?.from && range?.to) {
      const periodRange: PeriodRange = { dateFrom: range.from, dateTo: range.to };
      loadAnalytics(periodRange);
      loadMessages(periodRange, 1);
    }
  }

  // Handle pagination
  function handlePageChange(page: number) {
    if (currentPeriodRange) {
      loadMessages(currentPeriodRange, page);
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalMessages / pageSize));

  return (
    <div className="space-y-8" data-testid="analytics-dashboard">
      {/* Period filter */}
      <div className="flex flex-wrap items-center gap-4">
        <Select value={period} onValueChange={handlePeriodChange}>
          <SelectTrigger className="w-[220px]" data-testid="analytics-period-select">
            <SelectValue placeholder="Selecione o período" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="current_month">Mês corrente</SelectItem>
            <SelectItem value="previous_month">Mês anterior</SelectItem>
            <SelectItem value="last_90_days">Últimos 90 dias</SelectItem>
            <SelectItem value="custom">Personalizado</SelectItem>
          </SelectContent>
        </Select>

        {period === 'custom' && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" data-testid="analytics-custom-range-trigger">
                <CalendarIcon className="h-4 w-4" aria-hidden="true" />
                {customRange?.from && customRange?.to
                  ? `${format(customRange.from, 'dd/MM/yyyy')} - ${format(customRange.to, 'dd/MM/yyyy')}`
                  : 'Selecionar período'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                selected={customRange}
                onSelect={handleCustomRangeSelect}
                locale={ptBR}
                numberOfMonths={2}
                data-testid="analytics-custom-calendar"
              />
            </PopoverContent>
          </Popover>
        )}

        {isPending && (
          <Loader2 className="text-text-tertiary h-4 w-4 animate-spin" aria-hidden="true" />
        )}
      </div>

      {/* Summary cards — 4 cols desktop, 2 cols mobile */}
      <div className="grid grid-cols-2 gap-4 md:gap-6 lg:grid-cols-4">
        <SummaryCard
          label="Enviadas no mês"
          value={String(data.totalSent)}
          testId="analytics-card-sent"
        />
        <SummaryCard
          label="Taxa de entrega"
          value={formatPercentage(data.totalDelivered, data.totalSent)}
          helperText={`${data.totalDelivered} de ${data.totalSent}`}
          testId="analytics-card-delivery"
        />
        <SummaryCard
          label="Taxa de leitura"
          value={formatPercentage(data.totalRead, data.totalSent)}
          helperText={`${data.totalRead} de ${data.totalSent}`}
          testId="analytics-card-read"
        />
        <SummaryCard
          label="Taxa de confirmação"
          value={formatPercentage(data.totalConfirmed, data.totalSent)}
          helperText={`${data.totalConfirmed} confirmadas`}
          testId="analytics-card-confirmation"
        />
        <SummaryCard
          label="Custo estimado"
          value={currencyFormatter.format(data.estimatedCostBrl)}
          testId="analytics-card-cost"
          isLargeValue
        />
      </div>

      {/* Message history table */}
      <div data-testid="analytics-message-table">
        {/* Desktop table */}
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paciente</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Data/hora</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {messages.length === 0 && !isLoadingMessages ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-text-tertiary py-8 text-center text-sm">
                    Nenhuma mensagem encontrada para o período selecionado.
                  </TableCell>
                </TableRow>
              ) : (
                messages.map((item) => {
                  const badge = statusToBadge(item.message.status);
                  return (
                    <TableRow key={item.message.id}>
                      <TableCell className="font-medium">{item.patientName}</TableCell>
                      <TableCell className="text-text-secondary">
                        {item.message.templateKey ?? 'Texto livre'}
                      </TableCell>
                      <TableCell className="text-text-secondary">
                        {formatDateTime(item.message.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile stacked cards */}
        <div className="space-y-3 md:hidden">
          {messages.length === 0 && !isLoadingMessages ? (
            <div className="text-text-tertiary py-8 text-center text-sm">
              Nenhuma mensagem encontrada para o período selecionado.
            </div>
          ) : (
            messages.map((item) => {
              const badge = statusToBadge(item.message.status);
              return (
                <Card key={item.message.id} className="shadow-none">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-text-primary truncate text-[15px] font-medium">
                          {item.patientName}
                        </p>
                        <p className="text-text-secondary mt-0.5 text-[13px]">
                          {item.message.templateKey ?? 'Texto livre'}
                        </p>
                        <p className="text-text-tertiary mt-0.5 text-[12px]">
                          {formatDateTime(item.message.createdAt)}
                        </p>
                      </div>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Pagination */}
        {totalMessages > pageSize && (
          <div
            className="flex items-center justify-center gap-2 pt-6"
            data-testid="analytics-pagination"
          >
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1 || isLoadingMessages}
              onClick={() => handlePageChange(currentPage - 1)}
              aria-label="Página anterior"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <span className="text-text-secondary text-sm">
              {currentPage} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages || isLoadingMessages}
              onClick={() => handlePageChange(currentPage + 1)}
              aria-label="Próxima página"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            {isLoadingMessages && (
              <Loader2 className="text-text-tertiary h-4 w-4 animate-spin" aria-hidden="true" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SummaryCard sub-component
// ---------------------------------------------------------------------------

interface SummaryCardProps {
  label: string;
  value: string;
  helperText?: string;
  testId: string;
  isLargeValue?: boolean;
}

function SummaryCard({ label, value, helperText, testId, isLargeValue }: SummaryCardProps) {
  return (
    <Card className="shadow-none" data-testid={testId}>
      <CardContent className="p-4 md:p-6">
        <p className="text-text-tertiary text-[12px] font-medium tracking-[0.06em] uppercase">
          {label}
        </p>
        <p
          className={
            isLargeValue
              ? 'text-text-primary mt-1 text-[17px] font-normal'
              : 'text-text-primary mt-1 text-[22px] leading-[1.25] font-semibold'
          }
        >
          {value}
        </p>
        {helperText && <p className="text-text-tertiary mt-0.5 text-[13px]">{helperText}</p>}
      </CardContent>
    </Card>
  );
}
