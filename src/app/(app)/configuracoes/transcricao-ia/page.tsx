import { Suspense } from 'react';

import {
  getTranscriptionSettingsImpl,
  getTranscriptionStatsImpl,
  type TranscriptionSettingsView,
  type TranscriptionStatsView,
} from '@/modules/ai-transcription';
import { createServerClient } from '@/shared/supabase/server';

import { TranscriptionSettingsForm } from './_components/transcription-settings-form';
import { TranscriptionStatsPanel } from './_components/transcription-stats-panel';

// ---------------------------------------------------------------------------
// Inner async component that fetches data
// ---------------------------------------------------------------------------

/**
 * Resolves the authenticated user (the impls call `supabase.auth.getUser()`)
 * and reads settings + stats in parallel (`Promise.all`, no waterfall). Both
 * reads are owner-scoped server-side; a missing session yields `UNAUTHORIZED`
 * and we render a neutral error rather than leaking anything.
 *
 * Gating: this route lives under `/configuracoes/*`, which `middleware.ts`
 * already classifies as `'app'` (gated) — an anonymous request never reaches
 * this component. The `getUser()` check below is defense-in-depth.
 */
async function TranscriptionSettingsServer() {
  const supabase = await createServerClient();

  const [settings, stats] = await Promise.all([
    getTranscriptionSettingsImpl(supabase),
    getTranscriptionStatsImpl(supabase),
  ]);

  if (!settings.ok || !stats.ok) {
    return (
      <div className="text-text-secondary py-12 text-center">
        Erro ao carregar configurações. Tente novamente.
      </div>
    );
  }

  const settingsView: TranscriptionSettingsView = {
    enabled: settings.enabled,
    defaultTemplate: settings.defaultTemplate,
    riskDetectionSensitivity: settings.riskDetectionSensitivity,
    keepAudioHours: settings.keepAudioHours,
    keepTranscription: settings.keepTranscription,
  };
  const statsView: TranscriptionStatsView = {
    totalProcessed: stats.totalProcessed,
    monthProcessed: stats.monthProcessed,
    reviewed: stats.reviewed,
    savedToProntuario: stats.savedToProntuario,
    estimatedMinutesSaved: stats.estimatedMinutesSaved,
    acceptanceRatePercent: stats.acceptanceRatePercent,
    avgCostUsd: stats.avgCostUsd,
    failedCount: stats.failedCount,
  };

  return (
    <div className="space-y-8">
      <TranscriptionSettingsForm initial={settingsView} />
      <TranscriptionStatsPanel stats={statsView} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function TranscricaoIaSettingsPage() {
  return (
    <>
      <div className="mb-6">
        <h1
          className="text-text-primary text-[28px] leading-[1.25] font-semibold"
          data-testid="transcricao-ia-settings-page-title"
        >
          Transcrição IA
        </h1>
      </div>

      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        }
      >
        <TranscriptionSettingsServer />
      </Suspense>
    </>
  );
}
