'use client';

import { useCallback, useState } from 'react';

import type { TemplateType } from '@/modules/medical-records/lib/template-types';
import { TiptapEditor } from '@/modules/patients/components/tiptap-editor';
import { useAutoSave } from '@/modules/patients/lib/use-auto-save';
import { cn } from '@/shared/lib/utils';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

import { AutoSaveIndicator } from './auto-save-indicator';

// ---------------------------------------------------------------------------
// Field definitions per template type
// ---------------------------------------------------------------------------

interface RichTextField {
  type: 'rich';
  key: string;
  label: string;
  placeholder: string;
}

interface NumberField {
  type: 'number';
  key: string;
  label: string;
  min: number;
  max: number;
}

interface SelectField {
  type: 'select';
  key: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}

interface StringListField {
  type: 'string-list';
  key: string;
  label: string;
  placeholder: string;
}

type FieldDefinition = RichTextField | NumberField | SelectField | StringListField;

const TAREFA_STATUS_OPTIONS = [
  { value: 'sim', label: 'Sim' },
  { value: 'parcial', label: 'Parcial' },
  { value: 'nao', label: 'Não' },
] as const;

const TEMPLATE_FIELDS: Record<TemplateType, FieldDefinition[]> = {
  tcc: [
    { type: 'number', key: 'humor_inicial', label: 'Humor Inicial (0-10)', min: 0, max: 10 },
    { type: 'number', key: 'humor_final', label: 'Humor Final (0-10)', min: 0, max: 10 },
    {
      type: 'rich',
      key: 'pauta_sessao',
      label: 'Pauta da Sessão',
      placeholder: 'Descreva a pauta da sessão...',
    },
    {
      type: 'rich',
      key: 'conteudo_trabalhado',
      label: 'Conteúdo Trabalhado',
      placeholder: 'Descreva o conteúdo trabalhado...',
    },
    {
      type: 'rich',
      key: 'tarefa_casa_atribuida',
      label: 'Tarefa de Casa Atribuída',
      placeholder: 'Descreva a tarefa atribuída...',
    },
    {
      type: 'select',
      key: 'tarefa_anterior_status',
      label: 'Status da Tarefa Anterior',
      options: TAREFA_STATUS_OPTIONS,
    },
    {
      type: 'rich',
      key: 'proximos_passos',
      label: 'Próximos Passos',
      placeholder: 'Descreva os próximos passos...',
    },
  ],
  psicanalise: [
    {
      type: 'rich',
      key: 'conteudo_manifesto',
      label: 'Conteúdo Manifesto',
      placeholder: 'Descreva o conteúdo manifesto...',
    },
    {
      type: 'rich',
      key: 'associacoes_livres',
      label: 'Associações Livres',
      placeholder: 'Registre as associações livres...',
    },
    {
      type: 'rich',
      key: 'sonhos_relatados',
      label: 'Sonhos Relatados',
      placeholder: 'Descreva os sonhos relatados...',
    },
    {
      type: 'rich',
      key: 'transferencia_observada',
      label: 'Transferência Observada',
      placeholder: 'Descreva a transferência observada...',
    },
  ],
  sistemica: [
    {
      type: 'string-list',
      key: 'participantes',
      label: 'Participantes',
      placeholder: 'Nome do participante',
    },
    {
      type: 'rich',
      key: 'conteudo_trabalhado',
      label: 'Conteúdo Trabalhado',
      placeholder: 'Descreva o conteúdo trabalhado...',
    },
    {
      type: 'rich',
      key: 'padroes_observados',
      label: 'Padrões Observados',
      placeholder: 'Descreva os padrões observados...',
    },
    {
      type: 'rich',
      key: 'intervencao_realizada',
      label: 'Intervenção Realizada',
      placeholder: 'Descreva a intervenção realizada...',
    },
    {
      type: 'rich',
      key: 'tarefa_casa',
      label: 'Tarefa de Casa',
      placeholder: 'Descreva a tarefa de casa...',
    },
  ],
  aba: [
    {
      type: 'rich',
      key: 'comportamentos_alvo',
      label: 'Comportamentos Alvo',
      placeholder: 'Descreva os comportamentos alvo...',
    },
    {
      type: 'rich',
      key: 'linha_base',
      label: 'Linha de Base',
      placeholder: 'Descreva a linha de base...',
    },
    {
      type: 'rich',
      key: 'abc',
      label: 'Análise ABC',
      placeholder: 'Descreva a análise antecedente-comportamento-consequência...',
    },
    {
      type: 'rich',
      key: 'reforcadores',
      label: 'Reforçadores',
      placeholder: 'Descreva os reforçadores utilizados...',
    },
    {
      type: 'rich',
      key: 'foco_proxima',
      label: 'Foco da Próxima Sessão',
      placeholder: 'Descreva o foco para a próxima sessão...',
    },
  ],
  livre: [
    { type: 'rich', key: 'conteudo', label: 'Conteúdo', placeholder: 'Escreva livremente...' },
  ],
  custom: [
    { type: 'rich', key: 'conteudo', label: 'Conteúdo', placeholder: 'Escreva livremente...' },
  ],
};

// ---------------------------------------------------------------------------
// Content type — flexible record to hold values for any template
// ---------------------------------------------------------------------------

type EvolutionContent = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EvolutionEditorProps {
  /** Current template type controlling the field layout. */
  templateType: TemplateType;
  /** Initial content (from existing evolution or empty). */
  initialContent: EvolutionContent;
  /** Async save function called by auto-save. */
  onSave: (content: EvolutionContent) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Template-aware evolution editor. Renders structured fields based on the
 * selected template type (TCC, Psicanalise, Sistemica, ABA, Livre, Custom).
 *
 * Uses the TiptapEditor from the patients module for rich text fields,
 * integrates useAutoSave with a 10s debounce, and shows an AutoSaveIndicator.
 */
export function EvolutionEditor({ templateType, initialContent, onSave }: EvolutionEditorProps) {
  const [content, setContent] = useState<EvolutionContent>(() => ({ ...initialContent }));

  const handleSave = useCallback(
    async (contentToSave: EvolutionContent) => {
      await onSave(contentToSave);
    },
    [onSave],
  );

  const { status, lastSavedAt } = useAutoSave(content, handleSave, { interval: 10_000 });

  const fields = TEMPLATE_FIELDS[templateType];

  const updateField = useCallback((key: string, value: unknown) => {
    setContent((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <div className="flex max-w-[720px] flex-col gap-6" data-testid="evolution-editor">
      {/* Auto-save indicator */}
      <AutoSaveIndicator status={status} lastSavedAt={lastSavedAt} />

      {/* Fields */}
      {fields.map((field) => (
        <EvolutionField
          key={`${templateType}-${field.key}`}
          field={field}
          value={content[field.key]}
          onChange={(value) => updateField(field.key, value)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EvolutionField (internal — renders each field type)
// ---------------------------------------------------------------------------

interface EvolutionFieldProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
}

function EvolutionField({ field, value, onChange }: EvolutionFieldProps) {
  switch (field.type) {
    case 'rich':
      return (
        <div className="flex flex-col gap-1.5">
          <Label>{field.label}</Label>
          <div
            className={cn(
              'rounded-md border',
              'bg-surface-sunken',
              'focus-within:border-brand-500 focus-within:shadow-focus',
            )}
          >
            <TiptapEditor
              content={(value as string) ?? ''}
              onChange={(html) => onChange(html)}
              placeholder={field.placeholder}
              aria-label={field.label}
            />
          </div>
        </div>
      );

    case 'number':
      return (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`field-${field.key}`}>{field.label}</Label>
          <Input
            id={`field-${field.key}`}
            type="number"
            min={field.min}
            max={field.max}
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => {
              const parsed = e.target.value === '' ? undefined : Number(e.target.value);
              onChange(parsed);
            }}
            className="w-24"
          />
        </div>
      );

    case 'select':
      return (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`field-${field.key}`}>{field.label}</Label>
          <Select value={(value as string) ?? ''} onValueChange={(v) => onChange(v)}>
            <SelectTrigger id={`field-${field.key}`} className="w-[200px]">
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );

    case 'string-list':
      return (
        <StringListField field={field} value={value as string[] | undefined} onChange={onChange} />
      );
  }
}

// ---------------------------------------------------------------------------
// StringListField — manage a dynamic list of string entries
// ---------------------------------------------------------------------------

interface StringListFieldProps {
  field: StringListField;
  value: string[] | undefined;
  onChange: (value: string[]) => void;
}

function StringListField({ field, value, onChange }: StringListFieldProps) {
  const items = value ?? [''];

  const handleItemChange = (index: number, newValue: string) => {
    const updated = [...items];
    updated[index] = newValue;
    onChange(updated);
  };

  const handleAdd = () => {
    onChange([...items, '']);
  };

  const handleRemove = (index: number) => {
    if (items.length <= 1) return;
    const updated = items.filter((_, i) => i !== index);
    onChange(updated);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{field.label}</Label>
      <div className="flex flex-col gap-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={item}
              onChange={(e) => handleItemChange(index, e.target.value)}
              placeholder={field.placeholder}
              className="flex-1"
            />
            {items.length > 1 && (
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className="text-text-tertiary hover:text-danger-700 text-sm"
                aria-label={`Remover ${field.label} ${index + 1}`}
              >
                Remover
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={handleAdd}
          className="text-brand-700 self-start text-sm font-medium"
        >
          + Adicionar participante
        </button>
      </div>
    </div>
  );
}
