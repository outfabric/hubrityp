'use client';

import { Wrench } from 'lucide-react';
import { useId } from 'react';

import { TiptapEditor } from '@/modules/patients/components/tiptap-editor';
import { cn } from '@/shared/lib/utils';
import { Label } from '@/shared/ui/label';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ResourcesEditorProps {
  /** Current HTML content for the resources field. */
  value: string;
  /** Callback when content changes. */
  onChange: (html: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Tiptap rich-text editor for the `resources` field of a treatment plan.
 *
 * Reuses the shared TiptapEditor config (bold, italic, H3/H4, bullet list,
 * numbered list) from anamnesis/evolutions. Styled with Salvia tokens:
 * bg surface-sunken, border, focus brand-500, radius md, max-width 720px.
 */
export function ResourcesEditor({ value, onChange }: ResourcesEditorProps) {
  const editorId = useId();

  return (
    <div className="flex max-w-[720px] flex-col gap-1.5" data-testid="resources-editor">
      <Label htmlFor={editorId} className="flex items-center gap-1.5">
        <Wrench className="h-4 w-4" aria-hidden="true" />
        Recursos terapêuticos
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
          placeholder="Descreva os recursos terapêuticos utilizados..."
          aria-label="Recursos terapêuticos"
        />
      </div>
    </div>
  );
}
