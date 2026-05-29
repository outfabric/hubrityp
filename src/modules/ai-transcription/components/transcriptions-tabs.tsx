'use client';

import type { TranscriptionListBuckets, TranscriptionListItem } from '@/modules/ai-transcription';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';

import { TranscriptionListCard } from './transcription-list-card';
import { TranscriptionsEmptyState } from './transcriptions-empty-state';

// ---------------------------------------------------------------------------
// Per-tab content
// ---------------------------------------------------------------------------

function TabPanel({ items, emptyLabel }: { items: TranscriptionListItem[]; emptyLabel: string }) {
  if (items.length === 0) {
    return (
      <p className="text-text-secondary py-12 text-center text-sm" data-testid="tab-empty-label">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <TranscriptionListCard key={item.transcriptionId} item={item} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TranscriptionsTabsProps {
  buckets: TranscriptionListBuckets;
}

/**
 * Client-side tab switcher for the transcription review list.
 *
 * Holds the three buckets ("Pendentes", "Revisadas", "Falhas") and renders the
 * matching cards per tab. The default tab is "Pendentes" — the priority bucket
 * per the spec. When ALL buckets are empty the page renders the global
 * `TranscriptionsEmptyState` instead of this component, so this component only
 * has to handle the "this specific tab is empty" case.
 */
export function TranscriptionsTabs({ buckets }: TranscriptionsTabsProps) {
  return (
    <Tabs defaultValue="pending" data-testid="transcriptions-tabs">
      <TabsList>
        <TabsTrigger value="pending" data-testid="tab-pending">
          Pendentes
        </TabsTrigger>
        <TabsTrigger value="reviewed" data-testid="tab-reviewed">
          Revisadas
        </TabsTrigger>
        <TabsTrigger value="failed" data-testid="tab-failed">
          Falhas
        </TabsTrigger>
      </TabsList>

      <TabsContent value="pending" data-testid="panel-pending">
        <TabPanel items={buckets.pending} emptyLabel="Nenhuma transcrição pendente de revisão." />
      </TabsContent>
      <TabsContent value="reviewed" data-testid="panel-reviewed">
        <TabPanel items={buckets.reviewed} emptyLabel="Nenhuma transcrição revisada ainda." />
      </TabsContent>
      <TabsContent value="failed" data-testid="panel-failed">
        <TabPanel items={buckets.failed} emptyLabel="Nenhuma transcrição com falha." />
      </TabsContent>
    </Tabs>
  );
}

/** Re-export so the page can compose the empty state without a second import. */
export { TranscriptionsEmptyState };
