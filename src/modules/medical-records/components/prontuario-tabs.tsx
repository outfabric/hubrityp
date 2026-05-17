'use client';

import { Brain, ClipboardList, FileText, Paperclip, Scale, StickyNote, Target } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  createHypothesis,
  listHypotheses,
  searchCid10,
  updateHypothesis,
  updateHypothesisStatus,
} from '@/app/(app)/pacientes/[id]/prontuario/actions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';

import { EmptyTabPlaceholder } from './empty-tab-placeholder';
import { HypothesesTab } from './hypotheses-tab';

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
    label: 'Evolucoes',
    description: '',
    functional: true,
    icon: FileText,
  },
  {
    value: 'hipoteses',
    label: 'Hipoteses',
    description: 'Hipoteses diagnosticas e formulacao do caso serao registradas aqui.',
    functional: true,
    icon: Brain,
  },
  {
    value: 'plano',
    label: 'Plano',
    description: 'O plano terapeutico e objetivos de tratamento serao gerenciados aqui.',
    functional: false,
    icon: Target,
  },
  {
    value: 'escalas',
    label: 'Escalas',
    description: 'Instrumentos e escalas psicometricas aplicadas serao registrados aqui.',
    functional: false,
    icon: Scale,
  },
  {
    value: 'documentos',
    label: 'Documentos',
    description: 'Laudos, relatorios e declaracoes serao gerados e armazenados aqui.',
    functional: false,
    icon: ClipboardList,
  },
  {
    value: 'anexos',
    label: 'Anexos',
    description: 'Arquivos enviados pelo paciente ou pelo profissional serao organizados aqui.',
    functional: false,
    icon: Paperclip,
  },
  {
    value: 'notas',
    label: 'Notas',
    description: 'Anotacoes rapidas e lembretes pessoais sobre o caso serao mantidos aqui.',
    functional: false,
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
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Prontuario tabs following the Salvia underline-style tab pattern.
 *
 * 7 tabs total:
 * - Evolucoes (functional — renders children)
 * - Hipoteses (functional — renders HypothesesTab)
 * - Plano, Escalas, Documentos, Anexos, Notas (each renders
 *   EmptyTabPlaceholder with contextual description)
 *
 * Active tab: border-bottom 2px brand-500 (handled by the shadcn Tabs primitive).
 */
export function ProntuarioTabs({ children, patientId }: ProntuarioTabsProps) {
  return (
    <Tabs defaultValue="evolucoes" data-testid="prontuario-tabs">
      <TabsList className="w-full overflow-x-auto" data-testid="prontuario-tabs-list">
        {TABS.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            data-testid={`prontuario-tab-${tab.value}`}
          >
            {tab.label}
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

      {/* Non-functional placeholder tabs */}
      {TABS.filter((tab) => !tab.functional).map((tab) => (
        <TabsContent
          key={tab.value}
          value={tab.value}
          data-testid={`prontuario-tab-content-${tab.value}`}
        >
          <EmptyTabPlaceholder icon={tab.icon} description={tab.description} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
