'use client';

import { AlertTriangle, Info, Loader2, Paperclip, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { TemplatePreview } from '@/modules/whatsapp';
import { checkClinicalContent } from '@/modules/whatsapp/lib/inbox/clinical-content-blocker';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Textarea } from '@/shared/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip';

import { TemplateReplyDialog } from './template-reply-dialog';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Meta's session window in milliseconds (24 hours). */
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Determines whether a given lastInboundAt timestamp is within the 24h
 * session window. Pure function — receives `now` as a parameter to avoid
 * impure `Date.now()` calls during render.
 */
function computeIsWithinWindow(lastInboundAt: Date | null, now: number): boolean {
  if (!lastInboundAt) return false;
  const elapsed = now - lastInboundAt.getTime();
  return elapsed < SESSION_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MessageComposerProps {
  patientId: string;
  lastInboundAt: Date | null;
  templates: TemplatePreview[];
  sendFreeTextReply: (patientId: string, input: unknown) => Promise<{ ok: boolean }>;
  sendTemplateReply: (
    patientId: string,
    templateKey: string,
    variables: Record<string, string>,
  ) => Promise<{ ok: boolean }>;
  onMessageSent?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Message composer footer for the conversation thread.
 *
 * Two states:
 *
 * **State 1** — Inside the 24h window (lastInboundAt < 24h ago):
 *   - Textarea (1-5 lines auto-grow), "Enviar" button, attach button (disabled).
 *   - Clinical-content blocker inline Alert (warning) if content is clinical.
 *
 * **State 2** — Outside the 24h window (lastInboundAt >= 24h or null):
 *   - Textarea readonly, opacity 50%.
 *   - Info Alert explaining the window expired.
 *   - "Enviar template..." button opens the TemplateReplyDialog.
 */
export function MessageComposer({
  patientId,
  lastInboundAt,
  templates,
  sendFreeTextReply,
  sendTemplateReply,
  onMessageSent,
}: MessageComposerProps) {
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Capture `now` once at mount to avoid impure Date.now() calls during render.
  const [mountTime] = useState(() => Date.now());
  const isWithinWindow = computeIsWithinWindow(lastInboundAt, mountTime);

  // Clinical-content check derived from body — pure computation, no effect needed.
  const clinicalBlocked = useMemo(() => {
    if (!body.trim()) return false;
    const result = checkClinicalContent(body);
    return !result.allowed;
  }, [body]);

  // Auto-grow textarea (1-5 lines)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to correctly calculate scrollHeight
    textarea.style.height = 'auto';

    const lineHeight = 20; // ~20px per line at 14px font
    const minHeight = lineHeight; // 1 line min
    const maxHeight = lineHeight * 5; // 5 lines max

    const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, [body]);

  const handleSend = useCallback(async () => {
    if (!body.trim() || clinicalBlocked || loading) return;

    setLoading(true);
    try {
      const result = await sendFreeTextReply(patientId, { body });

      if (result.ok) {
        setBody('');
        onMessageSent?.();
      }
    } finally {
      setLoading(false);
    }
  }, [body, clinicalBlocked, loading, patientId, sendFreeTextReply, onMessageSent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Send on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  // ---- State 2: Outside 24h window ----
  if (!isWithinWindow) {
    return (
      <div className="border-border-subtle space-y-3 border-t p-4">
        <Textarea
          readOnly
          placeholder="Escreva uma mensagem..."
          className="min-h-[40px] resize-none opacity-50"
          aria-disabled="true"
        />

        <Alert variant="info">
          <Info size={16} />
          <AlertDescription>A janela de 24h expirou. Use um template aprovado.</AlertDescription>
        </Alert>

        <Button variant="secondary" onClick={() => setTemplateDialogOpen(true)}>
          Enviar template...
        </Button>

        <TemplateReplyDialog
          open={templateDialogOpen}
          onOpenChange={setTemplateDialogOpen}
          patientId={patientId}
          templates={templates}
          sendTemplateReply={sendTemplateReply}
          onSent={onMessageSent}
        />
      </div>
    );
  }

  // ---- State 1: Inside 24h window ----
  return (
    <div className="border-border-subtle space-y-3 border-t p-4">
      {/* Clinical content warning */}
      {clinicalBlocked && (
        <Alert variant="warning">
          <AlertTriangle size={16} />
          <AlertDescription>
            Esse conteúdo parece ser clínico. Por política do WhatsApp e LGPD, conversas clínicas
            devem ficar no prontuário. Use mensagens administrativas apenas.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escreva uma mensagem..."
          className="min-h-[40px] resize-none"
          rows={1}
          aria-label="Mensagem"
        />

        {/* Attach button (disabled) */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" disabled aria-label="Anexar arquivo">
                <Paperclip size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Em breve</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Send button */}
        <Button
          size="sm"
          onClick={() => void handleSend()}
          disabled={!body.trim() || clinicalBlocked || loading}
          aria-label="Enviar mensagem"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          Enviar
        </Button>
      </div>
    </div>
  );
}
