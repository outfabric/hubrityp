'use client';

import { Info, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import type {
  Cid10Result,
  CreateHypothesisResult,
  HypothesisSummary,
  ListHypothesesResult,
  UpdateHypothesisResult,
  UpdateHypothesisStatusResult,
} from '@/modules/medical-records';
import type { HypothesisStatus } from '@/modules/medical-records/lib/schemas/hypothesis';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';

import { HypothesesEmptyState } from './hypotheses-empty-state';
import { HypothesisCard, type HypothesisCardData } from './hypothesis-card';
import { HypothesisFormSheet } from './hypothesis-form-sheet';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HypothesesTabProps {
  /** Patient ID to load/create hypotheses for. */
  patientId: string;
  /** Server action: list hypotheses for a patient. */
  listHypotheses: (input: {
    patientId: string;
    includeDiscarded?: boolean;
  }) => Promise<ListHypothesesResult>;
  /** Server action: create a hypothesis. */
  createHypothesis: (input: {
    patientId: string;
    description?: string;
    cid10Code?: string;
    cid10Description?: string;
    notes?: string;
  }) => Promise<CreateHypothesisResult>;
  /** Server action: update a hypothesis. */
  updateHypothesis: (input: {
    hypothesisId: string;
    description?: string;
    cid10Code?: string;
    cid10Description?: string;
    status?: HypothesisStatus;
    notes?: string;
  }) => Promise<UpdateHypothesisResult>;
  /** Server action: update hypothesis status. */
  updateHypothesisStatus: (input: {
    hypothesisId: string;
    status: HypothesisStatus;
    notes?: string;
  }) => Promise<UpdateHypothesisStatusResult>;
  /** Server action: search CID-10 codes. */
  searchCid10: (query: string) => Promise<Cid10Result[]>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Container component for the "Hipoteses Diagnosticas" tab.
 *
 * Responsibilities:
 * - Header row (h3 + Button)
 * - Educational info banner (RF-05.11, always visible, not dismissible)
 * - Conditional HypothesesList or EmptyState
 * - Sheet open/close state management
 * - Calls listHypothesesByPatient on mount
 * - Handles optimistic updates on create/status-change
 */
export function HypothesesTab({
  patientId,
  listHypotheses,
  createHypothesis,
  updateHypothesis,
  updateHypothesisStatus,
  searchCid10,
}: HypothesesTabProps) {
  const [hypotheses, setHypotheses] = useState<HypothesisCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingHypothesis, setEditingHypothesis] = useState<HypothesisCardData | null>(null);

  // Load hypotheses on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const result = await listHypotheses({ patientId, includeDiscarded: true });
      if (!cancelled && result.ok) {
        setHypotheses(mapSummariesToCards(result.hypotheses));
      }
      if (!cancelled) {
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [patientId, listHypotheses]);

  // Handlers
  const handleAdd = useCallback(() => {
    setEditingHypothesis(null);
    setSheetOpen(true);
  }, []);

  const handleEdit = useCallback(
    (id: string) => {
      const hypothesis = hypotheses.find((h) => h.id === id);
      if (hypothesis) {
        setEditingHypothesis(hypothesis);
        setSheetOpen(true);
      }
    },
    [hypotheses],
  );

  const handleConfirm = useCallback(
    (id: string) => {
      // Optimistic update
      const confirmedStatus: HypothesisStatus = 'confirmed';
      setHypotheses((prev) =>
        prev.map((h) =>
          h.id === id ? { ...h, status: confirmedStatus, updatedAt: new Date() } : h,
        ),
      );

      void updateHypothesisStatus({
        hypothesisId: id,
        status: 'confirmed',
      }).then(async (result) => {
        if (!result.ok) {
          // Revert optimistic update
          const reloadResult = await listHypotheses({ patientId, includeDiscarded: true });
          if (reloadResult.ok) {
            setHypotheses(mapSummariesToCards(reloadResult.hypotheses));
          }
          toast.error('Erro ao confirmar hipótese. Tente novamente.');
        } else {
          toast.success('Hipótese confirmada.');
        }
      });
    },
    [updateHypothesisStatus, listHypotheses, patientId],
  );

  const handleDiscard = useCallback(
    (id: string) => {
      // Optimistic update
      const discardedStatus: HypothesisStatus = 'discarded';
      setHypotheses((prev) =>
        prev.map((h) =>
          h.id === id ? { ...h, status: discardedStatus, updatedAt: new Date() } : h,
        ),
      );

      void updateHypothesisStatus({
        hypothesisId: id,
        status: 'discarded',
      }).then(async (result) => {
        if (!result.ok) {
          // Revert optimistic update
          const reloadResult = await listHypotheses({ patientId, includeDiscarded: true });
          if (reloadResult.ok) {
            setHypotheses(mapSummariesToCards(reloadResult.hypotheses));
          }
          toast.error('Erro ao descartar hipótese. Tente novamente.');
        } else {
          toast.success('Hipótese descartada.');
        }
      });
    },
    [updateHypothesisStatus, listHypotheses, patientId],
  );

  const handleSheetClose = useCallback(
    (open: boolean) => {
      setSheetOpen(open);
      if (!open) {
        // Reload data when sheet closes (after create/update)
        void listHypotheses({ patientId, includeDiscarded: true }).then((result) => {
          if (result.ok) {
            setHypotheses(mapSummariesToCards(result.hypotheses));
          }
        });
        setEditingHypothesis(null);
      }
    },
    [listHypotheses, patientId],
  );

  return (
    <div className="space-y-6" data-testid="hypotheses-tab">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h3 className="text-text-primary text-lg font-semibold">Hipóteses diagnósticas</h3>
        <Button onClick={handleAdd} data-testid="hypotheses-add-button">
          <Plus className="mr-2 h-4 w-4" />
          Adicionar hipótese
        </Button>
      </div>

      {/* Educational banner — RF-05.11 (always visible, not dismissible) */}
      <Alert variant="info" data-testid="hypotheses-educational-banner">
        <Info className="h-4 w-4" />
        <AlertDescription>
          Hipótese diagnóstica em psicologia tem natureza de orientação clínica, não de diagnóstico
          médico. CID-10 é referencial.
        </AlertDescription>
      </Alert>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16" data-testid="hypotheses-loading">
          <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : hypotheses.length === 0 ? (
        <HypothesesEmptyState onAdd={handleAdd} />
      ) : (
        <div className="space-y-4" data-testid="hypotheses-list">
          {hypotheses.map((hypothesis) => (
            <HypothesisCard
              key={hypothesis.id}
              hypothesis={hypothesis}
              onEdit={handleEdit}
              onConfirm={handleConfirm}
              onDiscard={handleDiscard}
            />
          ))}
        </div>
      )}

      {/* Form sheet */}
      <HypothesisFormSheet
        open={sheetOpen}
        onOpenChange={handleSheetClose}
        editingHypothesis={editingHypothesis}
        onCreate={createHypothesis}
        onUpdate={updateHypothesis}
        onSearchCid10={searchCid10}
        patientId={patientId}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapSummariesToCards(summaries: HypothesisSummary[]): HypothesisCardData[] {
  return summaries.map((s) => ({
    id: s.id,
    description: s.description,
    cid10Code: s.cid10Code,
    cid10Description: s.cid10Description,
    status: s.status as HypothesisStatus,
    notes: s.notes,
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
  }));
}
