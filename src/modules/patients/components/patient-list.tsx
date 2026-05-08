'use client';

import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import type { Patient } from '@/shared/db/schema/patients/tables';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

import type { ListPatientsQuery, PatientStatus, SortColumn, SortOrder } from '../lib/patient-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StatusFilter = PatientStatus | 'all';

interface PatientListProps {
  /** Initial patient data from server. */
  patients: Patient[];
  /** Total count for pagination. */
  total: number;
  /** Current page from server. */
  page: number;
  /** Page size used. */
  pageSize: number;
  /** Server action to refetch patients. */
  listAction: (query: unknown) => Promise<
    | {
        ok: true;
        patients: Patient[];
        total: number;
        page: number;
        pageSize: number;
      }
    | { ok: false; error: string; fieldErrors?: Record<string, string[]>; message?: string }
  >;
  /** Available tags for the multi-select filter (distinct tags from server). */
  availableTags?: string[];
}

// ---------------------------------------------------------------------------
// Helpers (defined outside component to avoid re-creation)
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/** Renders the sort direction indicator for a column header. */
function SortIndicator({
  column,
  activeColumn,
  activeOrder,
}: {
  column: SortColumn;
  activeColumn: SortColumn;
  activeOrder: SortOrder;
}) {
  if (activeColumn !== column) return null;
  return activeOrder === 'asc' ? (
    <ArrowUp className="ml-1 inline h-3 w-3" aria-hidden="true" />
  ) : (
    <ArrowDown className="ml-1 inline h-3 w-3" aria-hidden="true" />
  );
}

function statusBadgeVariant(status: string) {
  if (status === 'active') return 'success' as const;
  return 'neutral' as const;
}

function statusLabel(status: string) {
  if (status === 'active') return 'Ativo';
  return 'Arquivado';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PatientList({
  patients: initialPatients,
  total: initialTotal,
  page: initialPage,
  pageSize,
  listAction,
  availableTags = [],
}: PatientListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Local state derived from URL search params
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') ?? '');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    (searchParams.get('status') as StatusFilter) ?? 'active',
  );
  const [selectedTags, setSelectedTags] = useState<string[]>(
    searchParams.get('tags')?.split(',').filter(Boolean) ?? [],
  );
  const [sortColumn, setSortColumn] = useState<SortColumn>(
    (searchParams.get('sort') as SortColumn) ?? 'full_name',
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    (searchParams.get('order') as SortOrder) ?? 'asc',
  );
  const [currentPage, setCurrentPage] = useState(initialPage);

  // Data state
  const [patients, setPatients] = useState(initialPatients);
  const [total, setTotal] = useState(initialTotal);

  const debouncedSearch = useDebounce(searchTerm, 300);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Show tags filter panel
  const [showTagsFilter, setShowTagsFilter] = useState(false);

  // Track whether this is the initial render (skip the debounced-search
  // effect on mount so we don't double-fetch the SSR data).
  const isInitialMount = useRef(true);

  // Build query from state
  const buildQuery = useCallback(
    (overrides: Partial<ListPatientsQuery> = {}): ListPatientsQuery => ({
      page: currentPage,
      pageSize,
      sort: sortColumn,
      order: sortOrder,
      search: debouncedSearch || undefined,
      status: statusFilter === 'all' ? undefined : statusFilter,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      ...overrides,
    }),
    [currentPage, pageSize, sortColumn, sortOrder, debouncedSearch, statusFilter, selectedTags],
  );

  // Sync URL search params
  const syncUrlParams = useCallback(
    (query: ListPatientsQuery) => {
      const params = new URLSearchParams();
      if (query.search) params.set('search', query.search);
      if (query.status) params.set('status', query.status);
      if (query.tags && query.tags.length > 0) params.set('tags', query.tags.join(','));
      if (query.sort && query.sort !== 'full_name') params.set('sort', query.sort);
      if (query.order && query.order !== 'asc') params.set('order', query.order);
      if (query.page && query.page > 1) params.set('page', String(query.page));

      const paramString = params.toString();
      const newUrl = paramString ? `?${paramString}` : window.location.pathname;
      router.replace(newUrl, { scroll: false });
    },
    [router],
  );

  // Fetch data from server action
  const fetchPatients = useCallback(
    (query: ListPatientsQuery) => {
      startTransition(async () => {
        const result = await listAction(query);
        if (result.ok) {
          setPatients(result.patients);
          setTotal(result.total);
          setCurrentPage(result.page);
        }
        syncUrlParams(query);
      });
    },
    [listAction, syncUrlParams],
  );

  // React to debounced search changes (skip the initial mount to avoid
  // double-fetching the data the server already provided).
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const query = buildQuery({ page: 1, search: debouncedSearch || undefined });
    fetchPatients(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // Handle status filter change
  const handleStatusChange = (status: StatusFilter) => {
    setStatusFilter(status);
    const query = buildQuery({
      page: 1,
      status: status === 'all' ? undefined : status,
    });
    fetchPatients(query);
  };

  // Handle tag toggle
  const handleTagToggle = (tag: string) => {
    const newTags = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];
    setSelectedTags(newTags);
    const query = buildQuery({
      page: 1,
      tags: newTags.length > 0 ? newTags : undefined,
    });
    fetchPatients(query);
  };

  // Handle sort
  const handleSort = (column: SortColumn) => {
    let newOrder: SortOrder = 'asc';
    if (sortColumn === column) {
      newOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    }
    setSortColumn(column);
    setSortOrder(newOrder);
    const query = buildQuery({ sort: column, order: newOrder });
    fetchPatients(query);
  };

  // Handle pagination
  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPage(page);
    const query = buildQuery({ page });
    fetchPatients(query);
  };

  // Page numbers to display
  const pageNumbers = useMemo(() => {
    const pages: number[] = [];
    const maxVisible = 5;
    let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    const end = Math.min(totalPages, start + maxVisible - 1);
    start = Math.max(1, end - maxVisible + 1);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }, [currentPage, totalPages]);

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  if (
    patients.length === 0 &&
    !debouncedSearch &&
    statusFilter === 'active' &&
    selectedTags.length === 0
  ) {
    return (
      <div
        className="flex flex-col items-center justify-center py-20 text-center"
        data-testid="patient-list-empty"
      >
        <Users className="text-text-tertiary mb-4 h-12 w-12" aria-hidden="true" />
        <h4 className="text-text-primary text-base font-medium">Nenhum paciente cadastrado</h4>
        <p className="text-text-secondary mt-2 max-w-sm text-sm">
          Adicione seu primeiro paciente para come&#231;ar a organizar seus atendimentos.
        </p>
        <Link href="/pacientes/novo">
          <Button className="mt-6" data-testid="patient-list-add-first">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Novo Paciente
          </Button>
        </Link>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4" data-testid="patient-list">
      {/* Toolbar: Search + Filters + Add button */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-3">
          {/* Search input */}
          <div className="relative max-w-sm flex-1">
            <Search
              className="text-text-tertiary absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              type="search"
              placeholder="Buscar paciente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
              data-testid="patient-search-input"
              aria-label="Buscar paciente"
            />
          </div>

          {/* Tags filter toggle */}
          {availableTags.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowTagsFilter(!showTagsFilter)}
              aria-expanded={showTagsFilter}
              aria-controls="tags-filter-panel"
              data-testid="patient-tags-filter-toggle"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Filtros</span>
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Status segmented control */}
          <div
            className="border-border bg-surface-muted inline-flex rounded-lg border p-0.5"
            role="group"
            aria-label="Filtro de status"
            data-testid="patient-status-filter"
          >
            {(
              [
                { value: 'active', label: 'Ativos' },
                { value: 'archived', label: 'Arquivados' },
                { value: 'all', label: 'Todos' },
              ] as const
            ).map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => handleStatusChange(value)}
                className={`duration-fast rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === value
                    ? 'bg-surface text-text-primary shadow-xs'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
                aria-pressed={statusFilter === value}
                data-testid={`patient-status-${value}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Add patient button */}
          <Link href="/pacientes/novo">
            <Button data-testid="patient-add-button">
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Novo Paciente</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Tags filter panel */}
      {showTagsFilter && availableTags.length > 0 && (
        <div
          id="tags-filter-panel"
          className="border-border bg-surface flex flex-wrap gap-2 rounded-lg border p-3"
          data-testid="patient-tags-filter-panel"
        >
          {availableTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => handleTagToggle(tag)}
              className={`duration-fast rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                selectedTags.includes(tag)
                  ? 'bg-brand-100 text-brand-700'
                  : 'bg-surface-muted text-text-secondary hover:bg-surface-sunken'
              }`}
              aria-pressed={selectedTags.includes(tag)}
              data-testid={`patient-tag-${tag}`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* Loading overlay */}
      <div className={isPending ? 'pointer-events-none opacity-60' : ''}>
        {/* Desktop table (hidden below md) */}
        <div className="hidden md:block">
          <Table data-testid="patient-table">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[300px]">
                  <button
                    type="button"
                    onClick={() => handleSort('full_name')}
                    className="hover:text-text-primary inline-flex items-center"
                    data-testid="patient-sort-name"
                  >
                    Paciente
                    <SortIndicator
                      column="full_name"
                      activeColumn={sortColumn}
                      activeOrder={sortOrder}
                    />
                  </button>
                </TableHead>
                <TableHead>Contato</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => handleSort('created_at')}
                    className="hover:text-text-primary inline-flex items-center"
                    data-testid="patient-sort-created"
                  >
                    Cadastrado em
                    <SortIndicator
                      column="created_at"
                      activeColumn={sortColumn}
                      activeOrder={sortOrder}
                    />
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patients.map((patient) => (
                <TableRow key={patient.id} data-testid="patient-row">
                  <TableCell>
                    <Link
                      href={`/pacientes/${patient.id}`}
                      className="flex items-center gap-3 hover:underline"
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarImage src="" alt="" />
                        <AvatarFallback>{getInitials(patient.fullName)}</AvatarFallback>
                      </Avatar>
                      <span className="text-text-primary font-medium">{patient.fullName}</span>
                      {patient.coupleId && (
                        <Badge variant="info" data-testid="patient-couple-badge">
                          Casal
                        </Badge>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="text-text-secondary text-sm">
                      {patient.phone && <div>{patient.phone}</div>}
                      {patient.email && <div>{patient.email}</div>}
                      {!patient.phone && !patient.email && (
                        <span className="text-text-disabled">-</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(patient.status)}>
                      {statusLabel(patient.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {patient.tags.length > 0 ? (
                        patient.tags.map((tag) => (
                          <Badge key={tag} variant="neutral">
                            {tag}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-text-disabled">-</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-text-secondary text-sm">
                      {new Date(patient.createdAt).toLocaleDateString('pt-BR')}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Mobile cards (visible below md) */}
        <div className="space-y-3 md:hidden" data-testid="patient-cards-mobile">
          {patients.map((patient) => (
            <Link
              key={patient.id}
              href={`/pacientes/${patient.id}`}
              className="border-border bg-surface duration-fast hover:border-border-strong block rounded-xl border p-4 transition-colors"
              data-testid="patient-card"
            >
              <div className="flex items-start gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src="" alt="" />
                  <AvatarFallback>{getInitials(patient.fullName)}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-text-primary font-medium">{patient.fullName}</span>
                      {patient.coupleId && (
                        <Badge variant="info" data-testid="patient-couple-badge">
                          Casal
                        </Badge>
                      )}
                    </div>
                    <Badge variant={statusBadgeVariant(patient.status)}>
                      {statusLabel(patient.status)}
                    </Badge>
                  </div>
                  {(patient.phone || patient.email) && (
                    <div className="text-text-secondary mt-1 text-sm">
                      {patient.phone && <span>{patient.phone}</span>}
                      {patient.phone && patient.email && <span> &middot; </span>}
                      {patient.email && <span>{patient.email}</span>}
                    </div>
                  )}
                  {patient.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {patient.tags.map((tag) => (
                        <Badge key={tag} variant="neutral">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* No results for current filters */}
        {patients.length === 0 &&
          (debouncedSearch || statusFilter !== 'active' || selectedTags.length > 0) && (
            <div
              className="flex flex-col items-center justify-center py-12 text-center"
              data-testid="patient-list-no-results"
            >
              <Search className="text-text-tertiary mb-3 h-8 w-8" aria-hidden="true" />
              <h4 className="text-text-primary text-base font-medium">
                Nenhum resultado encontrado
              </h4>
              <p className="text-text-secondary mt-1 text-sm">
                Tente ajustar os filtros ou o termo de busca.
              </p>
            </div>
          )}
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between pt-2" data-testid="patient-pagination">
          <span className="text-text-secondary text-sm">
            {total} paciente{total !== 1 ? 's' : ''} encontrado{total !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              aria-label="Pagina anterior"
              data-testid="patient-pagination-prev"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            {pageNumbers.map((pageNum) => (
              <Button
                key={pageNum}
                variant={pageNum === currentPage ? 'default' : 'secondary'}
                size="sm"
                onClick={() => handlePageChange(pageNum)}
                aria-label={`Pagina ${pageNum}`}
                aria-current={pageNum === currentPage ? 'page' : undefined}
                data-testid={`patient-pagination-page-${pageNum}`}
              >
                {pageNum}
              </Button>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              aria-label="Proxima pagina"
              data-testid="patient-pagination-next"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
