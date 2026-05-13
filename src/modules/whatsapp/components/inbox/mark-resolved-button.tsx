'use client';

import { Check, CheckCircle2, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MarkResolvedButtonProps {
  patientId: string;
  markResolved: (patientId: string) => Promise<{ ok: boolean }>;
  onResolved?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Button to mark a conversation as resolved.
 *
 * Renders as a ghost sm button with a Check icon. Shows a loading spinner
 * during the server action call. On success, fires a Sonner toast with
 * success styling per Salvia DS:
 * - CheckCircle2 icon
 * - border-left success-500
 */
export function MarkResolvedButton({
  patientId,
  markResolved,
  onResolved,
}: MarkResolvedButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async () => {
    setLoading(true);

    try {
      const result = await markResolved(patientId);

      if (result.ok) {
        toast.success('Conversa marcada como resolvida', {
          icon: <CheckCircle2 size={16} className="text-success-500" />,
          className: 'border-l-4 border-l-success-500',
        });
        onResolved?.();
      }
    } finally {
      setLoading(false);
    }
  }, [patientId, markResolved, onResolved]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleClick()}
            disabled={loading}
            aria-label="Marcar como resolvida"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            <span>Marcar como resolvida</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Move conversa para Resolvidas</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
