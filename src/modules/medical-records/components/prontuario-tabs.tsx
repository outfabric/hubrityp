'use client';

import {
  Brain,
  ClipboardList,
  FileText,
  Lock,
  Paperclip,
  Scale,
  StickyNote,
  Target,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

import {
  createHypothesis,
  createScaleApplication,
  deleteAttachment,
  getAttachmentSignedUrl,
  getDocumentPdfUrl,
  getPersonalNotes,
  getTreatmentPlan,
  listAttachments,
  listDocumentsByPatient,
  listHypotheses,
  listScalesForPatient,
  listTreatmentPlanVersions,
  removePersonalNotesPassword,
  searchCid10,
  setPersonalNotesPassword,
  submitScaleResponses,
  updateHypothesis,
  updateHypothesisStatus,
  uploadAttachment,
  upsertPersonalNotes,
  upsertTreatmentPlan,
} from '@/app/(app)/pacientes/[id]/prontuario/actions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';

import { AttachmentsTab } from './attachments-tab';
import { HypothesesTab } from './hypotheses-tab';
import { PersonalNotesTab } from './personal-notes-tab';
import { ScalesTab } from './scales-tab';
import { TreatmentPlanTab } from './treatment-plan';

// Lazy-load the DocumentsTab — it pulls in Tiptap and the type config
// which are only needed when the user navigates to the "Documentos" tab.
const DocumentsTab = dynamic(() =>
  import('./documents-tab').then((mod) => ({ default: mod.DocumentsTab })),
);

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

interface TabDefinition {
  value: string;
  label: string;
  /** Description shown in the empty-tab-placeholder for non-functional tabs. */
  description: string;
  /** Whether the tab is functional (has real content). */
  functional: boolean;
  /** Lucide icon for the placeholder (non-functional tabs). */
  icon: typeof FileText;
}

const TABS: TabDefinition[] = [
  {
    value: 'evolucoes',
    label: 'Evoluções',
    description: '',
    functional: true,
    icon: FileText,
  },
  {
    value: 'hipoteses',
    label: 'Hipóteses',
    description: 'Hipóteses diagnósticas e formulação do caso serão registradas aqui.',
    functional: true,
    icon: Brain,
  },
  {
    value: 'plano',
    label: 'Plano',
    description: 'O plano terapêutico e objetivos de tratamento serão gerenciados aqui.',
    functional: true,
    icon: Target,
  },
  {
    value: 'escalas',
    label: 'Escalas',
    description: 'Instrumentos e escalas psicométricas aplicadas serão registrados aqui.',
    functional: true,
    icon: Scale,
  },
  {
    value: 'documentos',
    label: 'Documentos',
    description: 'Laudos, relatórios e declarações serão gerados e armazenados aqui.',
    functional: true,
    icon: ClipboardList,
  },
  {
    value: 'anexos',
    label: 'Anexos',
    description: 'Arquivos enviados pelo paciente ou pelo profissional serão organizados aqui.',
    functional: true,
    icon: Paperclip,
  },
  {
    value: 'notas',
    label: 'Notas',
    description: 'Anotações rápidas e lembretes pessoais sobre o caso serão mantidos aqui.',
    functional: true,
    icon: StickyNote,
  },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ProntuarioTabsProps {
  /** Content to render inside the "Evolucoes" tab. */
  children: ReactNode;
  /** Patient ID passed to sub-tab components that need it (e.g., HypothesesTab). */
  patientId: string;
  /** Whether the patient has an active consent term (gates audio uploads). */
  hasActiveConsent?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Prontuario tabs following the Salvia underline-style tab pattern.
 *
 * 7 tabs total — all functional:
 * - Evolucoes (renders children)
 * - Hipoteses (renders HypothesesTab)
 * - Plano (renders TreatmentPlanTab)
 * - Escalas (renders ScalesTab)
 * - Documentos (renders DocumentsTab, lazy-loaded)
 * - Anexos (renders AttachmentsTab)
 * - Notas (renders PersonalNotesTab, Lock icon in trigger)
 *
 * Active tab: border-bottom 2px brand-500 (handled by the shadcn Tabs primitive).
 */
export function ProntuarioTabs({
  children,
  patientId,
  hasActiveConsent = false,
}: ProntuarioTabsProps) {
  return (
    <Tabs defaultValue="evolucoes" data-testid="prontuario-tabs">
      <TabsList className="w-full overflow-x-auto" data-testid="prontuario-tabs-list">
        {TABS.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            data-testid={`prontuario-tab-${tab.value}`}
          >
            {tab.value === 'notas' ? (
              <span className="flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                {tab.label}
              </span>
            ) : (
              tab.label
            )}
          </TabsTrigger>
        ))}
      </TabsList>

      {/* Functional tab: Evolucoes */}
      <TabsContent value="evolucoes" data-testid="prontuario-tab-content-evolucoes">
        {children}
      </TabsContent>

      {/* Functional tab: Hipoteses */}
      <TabsContent value="hipoteses" data-testid="prontuario-tab-content-hipoteses">
        <HypothesesTab
          patientId={patientId}
          listHypotheses={listHypotheses}
          createHypothesis={createHypothesis}
          updateHypothesis={updateHypothesis}
          updateHypothesisStatus={updateHypothesisStatus}
          searchCid10={searchCid10}
        />
      </TabsContent>

      {/* Functional tab: Plano terapeutico */}
      <TabsContent value="plano" data-testid="prontuario-tab-content-plano">
        <TreatmentPlanTab
          patientId={patientId}
          getTreatmentPlan={getTreatmentPlan}
          upsertTreatmentPlan={upsertTreatmentPlan}
          listTreatmentPlanVersions={listTreatmentPlanVersions}
        />
      </TabsContent>

      {/* Functional tab: Escalas */}
      <TabsContent value="escalas" data-testid="prontuario-tab-content-escalas">
        <ScalesTab
          patientId={patientId}
          listScalesForPatient={listScalesForPatient}
          createScaleApplication={createScaleApplication}
          submitScaleResponses={submitScaleResponses}
        />
      </TabsContent>

      {/* Functional tab: Documentos clinicos */}
      <TabsContent value="documentos" data-testid="prontuario-tab-content-documentos">
        <DocumentsTab
          patientId={patientId}
          listDocumentsByPatient={listDocumentsByPatient}
          getDocumentPdfUrl={getDocumentPdfUrl}
        />
      </TabsContent>

      {/* Functional tab: Anexos */}
      <TabsContent value="anexos" data-testid="prontuario-tab-content-anexos">
        <AttachmentsTab
          patientId={patientId}
          hasActiveConsent={hasActiveConsent}
          listAttachments={listAttachments}
          uploadAttachment={uploadAttachment}
          getAttachmentSignedUrl={getAttachmentSignedUrl}
          deleteAttachment={deleteAttachment}
        />
      </TabsContent>

      {/* Functional tab: Notas pessoais */}
      <TabsContent value="notas" data-testid="prontuario-tab-content-notas">
        <PersonalNotesTab
          patientId={patientId}
          getPersonalNotes={getPersonalNotes}
          upsertPersonalNotes={upsertPersonalNotes}
          setPersonalNotesPassword={setPersonalNotesPassword}
          removePersonalNotesPassword={removePersonalNotesPassword}
        />
      </TabsContent>
    </Tabs>
  );
}
