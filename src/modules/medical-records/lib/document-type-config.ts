import type { LucideIcon } from 'lucide-react';
import { FileBadge, FileBarChart, FileEdit, FileSearch, FileText } from 'lucide-react';

import type { DocumentType } from './schemas/clinical-documents';

// ---------------------------------------------------------------------------
// Document type metadata (icons, labels, descriptions)
// ---------------------------------------------------------------------------

export interface DocumentTypeConfig {
  type: DocumentType;
  icon: LucideIcon;
  label: string;
  description: string;
}

export const DOCUMENT_TYPE_CONFIGS: Record<DocumentType, DocumentTypeConfig> = {
  declaracao: {
    type: 'declaracao',
    icon: FileText,
    label: 'Declaracao Psicologica',
    description: 'Informa sobre comparecimento, acompanhamento ou participacao.',
  },
  atestado: {
    type: 'atestado',
    icon: FileBadge,
    label: 'Atestado Psicologico',
    description: 'Certifica condicoes clinicas psicologicas do paciente.',
  },
  relatorio: {
    type: 'relatorio',
    icon: FileBarChart,
    label: 'Relatorio Psicologico',
    description: 'Descreve e analisa procedimentos e resultados do atendimento.',
  },
  laudo: {
    type: 'laudo',
    icon: FileSearch,
    label: 'Laudo Psicologico',
    description: 'Apresenta analise aprofundada de fatos e conclusao tecnica.',
  },
  parecer: {
    type: 'parecer',
    icon: FileEdit,
    label: 'Parecer Psicologico',
    description: 'Oferece opiniao tecnica fundamentada sobre questao especifica.',
  },
};

export const DOCUMENT_TYPE_LIST: DocumentTypeConfig[] = [
  DOCUMENT_TYPE_CONFIGS.declaracao,
  DOCUMENT_TYPE_CONFIGS.atestado,
  DOCUMENT_TYPE_CONFIGS.relatorio,
  DOCUMENT_TYPE_CONFIGS.laudo,
  DOCUMENT_TYPE_CONFIGS.parecer,
];

// ---------------------------------------------------------------------------
// Section configuration per document type
// ---------------------------------------------------------------------------

/** All section keys recognized by the structured editor. */
export type SectionKey =
  | 'solicitante'
  | 'demanda'
  | 'procedimentos'
  | 'analise'
  | 'conclusao'
  | 'localData'
  | 'cid10Codes'
  | 'period'
  | 'validity';

export interface SectionConfig {
  key: SectionKey;
  label: string;
  placeholder: string;
  required: boolean;
}

const SECTIONS: Record<SectionKey, Omit<SectionConfig, 'required'>> = {
  solicitante: {
    key: 'solicitante',
    label: 'Solicitante',
    placeholder: 'Identifique quem solicitou este documento...',
  },
  demanda: {
    key: 'demanda',
    label: 'Demanda',
    placeholder: 'Descreva a demanda ou motivo da solicitacao...',
  },
  procedimentos: {
    key: 'procedimentos',
    label: 'Procedimentos',
    placeholder: 'Descreva os procedimentos utilizados...',
  },
  analise: {
    key: 'analise',
    label: 'Analise',
    placeholder: 'Apresente a analise tecnica dos dados coletados...',
  },
  conclusao: {
    key: 'conclusao',
    label: 'Conclusao',
    placeholder: 'Apresente a conclusao ou parecer tecnico...',
  },
  localData: {
    key: 'localData',
    label: 'Local e Data',
    placeholder: 'Informe o local e data de emissao...',
  },
  cid10Codes: {
    key: 'cid10Codes',
    label: 'CID-10',
    placeholder: '',
  },
  period: {
    key: 'period',
    label: 'Periodo',
    placeholder: 'Informe o periodo de validade ou abrangencia...',
  },
  validity: {
    key: 'validity',
    label: 'Validade',
    placeholder: 'Informe a validade do atestado...',
  },
};

/**
 * Sections per document type, ordered as they should appear in the editor.
 * `required` reflects CFP 06/2019 rules — analise is required only for
 * relatorio, laudo, and parecer.
 */
export const DOCUMENT_SECTIONS: Record<DocumentType, SectionConfig[]> = {
  declaracao: [
    { ...SECTIONS.solicitante, required: true },
    { ...SECTIONS.demanda, required: true },
    { ...SECTIONS.procedimentos, required: true },
    { ...SECTIONS.conclusao, required: true },
    { ...SECTIONS.localData, required: true },
    { ...SECTIONS.cid10Codes, required: false },
  ],
  atestado: [
    { ...SECTIONS.solicitante, required: true },
    { ...SECTIONS.demanda, required: true },
    { ...SECTIONS.procedimentos, required: true },
    { ...SECTIONS.conclusao, required: true },
    { ...SECTIONS.localData, required: true },
    { ...SECTIONS.period, required: false },
    { ...SECTIONS.validity, required: false },
    { ...SECTIONS.cid10Codes, required: false },
  ],
  relatorio: [
    { ...SECTIONS.solicitante, required: true },
    { ...SECTIONS.demanda, required: true },
    { ...SECTIONS.procedimentos, required: true },
    { ...SECTIONS.analise, required: true },
    { ...SECTIONS.conclusao, required: true },
    { ...SECTIONS.localData, required: true },
    { ...SECTIONS.cid10Codes, required: false },
  ],
  laudo: [
    { ...SECTIONS.solicitante, required: true },
    { ...SECTIONS.demanda, required: true },
    { ...SECTIONS.procedimentos, required: true },
    { ...SECTIONS.analise, required: true },
    { ...SECTIONS.conclusao, required: true },
    { ...SECTIONS.localData, required: true },
    { ...SECTIONS.cid10Codes, required: false },
  ],
  parecer: [
    { ...SECTIONS.solicitante, required: true },
    { ...SECTIONS.demanda, required: true },
    { ...SECTIONS.procedimentos, required: true },
    { ...SECTIONS.analise, required: true },
    { ...SECTIONS.conclusao, required: true },
    { ...SECTIONS.localData, required: true },
    { ...SECTIONS.cid10Codes, required: false },
  ],
};
