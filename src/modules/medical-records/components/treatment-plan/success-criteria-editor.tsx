'use client';

import { CheckCircle2 } from 'lucide-react';
import { useId } from 'react';

import { TiptapEditor } from '@/modules/patients/components/tiptap-editor';
import { cn } from '@/shared/lib/utils';
import { Label } from '@/shared/ui/label';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SuccessCriteriaEditorProps {
  /** Current HTML content for the success criteria field. */
  value: string;
  /** Callback when content changes. */
  onChange: (html: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Tiptap rich-text editor for the `success_criteria` field of a treatment plan.
 *
 * Same config as ResourcesEditor (bold, italic, H3/H4, bullet list,
 * numbered list). Styled with Salvia tokens: bg surface-sunken, border,
 * focus brand-500, radius md, max-width 720px.
 */
export function SuccessCriteriaEditor({ value, onChange }: SuccessCriteriaEditorProps) {
  const editorId = useId();

  return (
    <div className="flex max-w-[720px] flex-col gap-1.5" data-testid="success-criteria-editor">
      <Label htmlFor={editorId} className="flex items-center gap-1.5">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        Criterios de sucesso
      </Label>
      <div
        id={editorId}
        className={cn(
          'rounded-md border',
          'bg-surface-sunken',
          'focus-within:border-brand-500 focus-within:shadow-focus',
        )}
      >
        <TiptapEditor
          content={value}
          onChange={onChange}
          placeholder="Descreva os criterios de sucesso do tratamento..."
          aria-label="Criterios de sucesso"
        />
      </div>
    </div>
  );
}
