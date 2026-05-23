'use client';

import { HelpCircle } from 'lucide-react';

import { Button } from '@/shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TroubleshootingPopoverProps {
  /**
   * When provided, step 4 shows the psychologist's name (patient view).
   * When absent, step 4 shows a generic "contate suporte" (psychologist view).
   */
  psychologistName?: string | null;
}

// ---------------------------------------------------------------------------
// Component
//
// Small help popover with static troubleshooting steps for video call issues.
// Triggered by a ghost HelpCircle button in the call controls bar.
// No API calls — purely presentational.
// ---------------------------------------------------------------------------

export function TroubleshootingPopover({ psychologistName }: TroubleshootingPopoverProps) {
  const step4Text = psychologistName
    ? `Se o problema persistir, entre em contato com ${psychologistName} por WhatsApp`
    : 'Se o problema persistir, entre em contato com o suporte';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Problema tecnico?"
          data-testid="troubleshooting-button"
        >
          <HelpCircle className="h-5 w-5" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" className="max-w-[320px]" data-testid="troubleshooting-popover">
        <p className="text-text-primary mb-3 text-sm font-medium">Problema tecnico?</p>
        <ol className="text-text-secondary list-decimal space-y-2 pl-4 text-sm">
          <li>Verifique se microfone e camera estao ativados nas configuracoes do navegador</li>
          <li>Saia e volte a entrar pelo mesmo link</li>
          <li>Tente usar Chrome ou Firefox</li>
          <li>{step4Text}</li>
        </ol>
      </PopoverContent>
    </Popover>
  );
}
