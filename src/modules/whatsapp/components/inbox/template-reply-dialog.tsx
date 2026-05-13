'use client';

import { Loader2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { TemplatePreview } from '@/modules/whatsapp';
import { renderTemplate } from '@/modules/whatsapp/lib/render-template';
import { TEMPLATE_LABELS } from '@/modules/whatsapp/lib/template-labels';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/shared/ui/sheet';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TemplateReplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  templates: TemplatePreview[];
  sendTemplateReply: (
    patientId: string,
    templateKey: string,
    variables: Record<string, string>,
  ) => Promise<{ ok: boolean }>;
  onSent?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract variable names from template body `{var_name}` placeholders.
 */
function extractVariableNames(body: string): string[] {
  const matches = body.matchAll(/\{(\w+)\}/g);
  const names = new Set<string>();
  for (const match of matches) {
    names.add(match[1]!);
  }
  return Array.from(names);
}

// ---------------------------------------------------------------------------
// Inner content (shared between Dialog and Sheet)
// ---------------------------------------------------------------------------

interface TemplateFormContentProps {
  templates: TemplatePreview[];
  selectedKey: string | null;
  onSelectedKeyChange: (key: string) => void;
  variableValues: Record<string, string>;
  onVariableChange: (name: string, value: string) => void;
  preview: string | null;
  variableNames: string[];
  loading: boolean;
  onSend: () => void;
  onCancel: () => void;
}

function TemplateFormContent({
  templates,
  selectedKey,
  onSelectedKeyChange,
  variableValues,
  onVariableChange,
  preview,
  variableNames,
  loading,
  onSend,
  onCancel,
}: TemplateFormContentProps) {
  // Only show approved templates in the select
  const approvedTemplates = templates.filter((t) => t.metaStatus === 'approved');

  return (
    <>
      {/* Template select */}
      <div className="space-y-2">
        <Label htmlFor="template-select">Template</Label>
        <Select value={selectedKey ?? ''} onValueChange={onSelectedKeyChange}>
          <SelectTrigger id="template-select">
            <SelectValue placeholder="Selecione um template..." />
          </SelectTrigger>
          <SelectContent>
            {approvedTemplates.map((t) => (
              <SelectItem key={t.templateKey} value={t.templateKey}>
                {TEMPLATE_LABELS[t.templateKey] ?? t.templateKey}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Variable inputs */}
      {variableNames.length > 0 && (
        <div className="space-y-3">
          {variableNames.map((varName) => (
            <div key={varName} className="space-y-1">
              <Label htmlFor={`var-${varName}`}>{varName}</Label>
              <Input
                id={`var-${varName}`}
                value={variableValues[varName] ?? ''}
                onChange={(e) => onVariableChange(varName, e.target.value)}
                placeholder={varName}
              />
            </div>
          ))}
        </div>
      )}

      {/* Preview */}
      {preview !== null && (
        <Card className="border-none shadow-none">
          <CardContent className="bg-surface-muted text-text-secondary rounded-lg p-4 text-[13px]">
            {preview}
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={loading}>
          Cancelar
        </Button>
        <Button onClick={onSend} disabled={loading || !selectedKey}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : null}
          Enviar
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dialog for sending a template-based WhatsApp reply when the 24h session
 * window has expired.
 *
 * Desktop: renders as a Dialog (max-width 640px, radius 2xl, padding space-8).
 * Mobile: renders as a Sheet bottom-up.
 *
 * Allows selecting an approved template, filling in variable values, and
 * previewing the rendered message before sending.
 */
export function TemplateReplyDialog({
  open,
  onOpenChange,
  patientId,
  templates,
  sendTemplateReply,
  onSent,
}: TemplateReplyDialogProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // Derived: selected template
  const selectedTemplate = templates.find((t) => t.templateKey === selectedKey);

  // Derived: variable names for the selected template
  const variableNames = useMemo(
    () => (selectedTemplate ? extractVariableNames(selectedTemplate.body) : []),
    [selectedTemplate],
  );

  // Derived: preview (rendered template body or null)
  const preview = useMemo(() => {
    if (!selectedTemplate) return null;
    try {
      return renderTemplate({ body: selectedTemplate.body, vars: variableValues });
    } catch {
      // Missing variables — show raw body instead
      return selectedTemplate.body;
    }
  }, [selectedTemplate, variableValues]);

  const handleVariableChange = useCallback((name: string, value: string) => {
    setVariableValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  // Handle template selection — also reset variables for the new template
  const handleSelectedKeyChange = useCallback((key: string) => {
    setSelectedKey(key);
    setVariableValues({});
  }, []);

  // Wrap onOpenChange to reset state when closing
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setSelectedKey(null);
        setVariableValues({});
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  const handleSend = useCallback(async () => {
    if (!selectedKey) return;

    setLoading(true);
    try {
      const result = await sendTemplateReply(patientId, selectedKey, variableValues);

      if (result.ok) {
        toast.success('Template enviado com sucesso');
        handleOpenChange(false);
        onSent?.();
      }
    } finally {
      setLoading(false);
    }
  }, [selectedKey, patientId, variableValues, sendTemplateReply, handleOpenChange, onSent]);

  const handleCancel = useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  const formProps: TemplateFormContentProps = {
    templates,
    selectedKey,
    onSelectedKeyChange: handleSelectedKeyChange,
    variableValues,
    onVariableChange: handleVariableChange,
    preview,
    variableNames,
    loading,
    onSend: () => void handleSend(),
    onCancel: handleCancel,
  };

  return (
    <>
      {/* Desktop: Dialog */}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="hidden max-w-[640px] md:grid">
          <DialogHeader>
            <DialogTitle>Enviar template</DialogTitle>
          </DialogHeader>
          <TemplateFormContent {...formProps} />
        </DialogContent>
      </Dialog>

      {/* Mobile: Sheet bottom-up */}
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto md:hidden">
          <SheetHeader>
            <SheetTitle>Enviar template</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <TemplateFormContent {...formProps} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
