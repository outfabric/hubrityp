'use client';

import { Calendar, Clock, FileText, Receipt, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

interface TabDefinition {
  value: string;
  label: string;
  icon: ReactNode;
  /** Whether the tab shows a generic "Em breve" placeholder. */
  placeholder: boolean;
}

const TABS: TabDefinition[] = [
  {
    value: 'overview',
    label: 'Visao geral',
    icon: null,
    placeholder: false,
  },
  {
    value: 'sessions',
    label: 'Historico de sessoes',
    icon: <Calendar className="h-4 w-4" aria-hidden="true" />,
    placeholder: true,
  },
  {
    value: 'records',
    label: 'Prontuario',
    icon: <FileText className="h-4 w-4" aria-hidden="true" />,
    placeholder: true,
  },
  {
    value: 'anamnesis',
    label: 'Anamnese',
    icon: <Clock className="h-4 w-4" aria-hidden="true" />,
    placeholder: false,
  },
  {
    value: 'documents',
    label: 'Documentos',
    icon: <Receipt className="h-4 w-4" aria-hidden="true" />,
    placeholder: true,
  },
  {
    value: 'financial',
    label: 'Financeiro',
    icon: <Wallet className="h-4 w-4" aria-hidden="true" />,
    placeholder: true,
  },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PatientTabsProps {
  /** Content for the "Visao geral" tab. */
  overviewContent: ReactNode;
  /** Content for the "Anamnese" tab. */
  anamnesisContent: ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PatientTabs({ overviewContent, anamnesisContent }: PatientTabsProps) {
  return (
    <Tabs defaultValue="overview" data-testid="patient-tabs">
      <TabsList className="w-full overflow-x-auto" data-testid="patient-tabs-list">
        {TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} data-testid={`patient-tab-${tab.value}`}>
            {tab.icon}
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {/* Active tab: overview */}
      <TabsContent value="overview" data-testid="patient-tab-content-overview">
        {overviewContent}
      </TabsContent>

      {/* Active tab: anamnesis */}
      <TabsContent value="anamnesis" data-testid="patient-tab-content-anamnesis">
        {anamnesisContent}
      </TabsContent>

      {/* Placeholder tabs */}
      {TABS.filter((tab) => tab.placeholder).map((tab) => (
        <TabsContent
          key={tab.value}
          value={tab.value}
          data-testid={`patient-tab-content-${tab.value}`}
        >
          <div className="flex flex-col items-center justify-center py-16 text-center">
            {tab.icon && (
              <div className="text-text-tertiary mb-3 [&>svg]:h-8 [&>svg]:w-8">{tab.icon}</div>
            )}
            <p
              className="text-text-tertiary text-sm"
              data-testid={`patient-tab-placeholder-${tab.value}`}
            >
              Em breve
            </p>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
