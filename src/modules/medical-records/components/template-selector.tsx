'use client';

import { TEMPLATE_OPTIONS, type TemplateType } from '@/modules/medical-records/lib/template-types';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TemplateSelectorProps {
  /** Currently selected template type. */
  value: TemplateType;
  /** Called when the user selects a different template. */
  onChange: (value: TemplateType) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Select dropdown for choosing the therapeutic approach template for an
 * evolution note. Uses shadcn Select with TEMPLATE_OPTIONS defined in the
 * medical-records lib.
 *
 * Label "Abordagem" is associated via for/id for accessibility.
 */
export function TemplateSelector({ value, onChange }: TemplateSelectorProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="template-type-select">Abordagem</Label>
      <Select value={value} onValueChange={(v) => onChange(v as TemplateType)}>
        <SelectTrigger id="template-type-select" className="w-[320px]">
          <SelectValue placeholder="Selecione uma abordagem" />
        </SelectTrigger>
        <SelectContent>
          {TEMPLATE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
