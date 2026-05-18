'use client';

import { Calendar, ClipboardList, FileText, Receipt, Wallet } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Button } from '@/shared/ui/button';
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
    icon: <ClipboardList className="h-4 w-4" aria-hidden="true" />,
    placeholder: false,
  },
  {
    value: 'documents',
    label: 'Documentos',
    icon: <Receipt className="h-4 w-4" aria-hidden="true" />,
    placeholder: false,
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
  /** Patient UUID — used to build links to the prontuario. */
  patientId: string;
  /** Content for the "Visao geral" tab. */
  overviewContent: ReactNode;
  /** Content for the "Anamnese" tab. */
  anamnesisContent: ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PatientTabs({ patientId, overviewContent, anamnesisContent }: PatientTabsProps) {
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

      {/* Active tab: documents — redirect panel pointing to the prontuario */}
      <TabsContent value="documents" data-testid="patient-tab-content-documents">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FileText className="text-text-tertiary mb-3 h-8 w-8" aria-hidden="true" />
          <h3 className="text-text-primary mb-1 text-base font-semibold">Documentos clinicos</h3>
          <p className="text-text-secondary mb-4 max-w-sm text-sm">
            Os documentos clinicos (declaracoes, atestados, laudos e outros) estao disponiveis no
            prontuario do paciente.
          </p>
          <Button asChild data-testid="patient-tab-documents-open-prontuario">
            <Link href={`/pacientes/${patientId}/prontuario`}>Abrir prontuario</Link>
          </Button>
        </div>
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
