'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2, MessageCircle } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import type { WhatsappAccount } from '@/shared/db/schema/whatsapp/tables';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/alert-dialog';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader } from '@/shared/ui/card';

import { ConnectWhatsappDialog } from './connect-whatsapp-dialog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WhatsappAccountCardProps {
  account: WhatsappAccount | null;
  onDisconnect: () => Promise<{ ok: true } | { ok: false; error: string; message?: string }>;
  onStartConnection: (
    input: unknown,
  ) => Promise<
    | { ok: true; senderSid: string; verificationMethod: string }
    | { ok: false; error: string; fieldErrors?: Record<string, string[]>; message?: string }
  >;
  onCompleteConnection: (
    input: unknown,
  ) => Promise<
    | { ok: true }
    | { ok: false; error: string; fieldErrors?: Record<string, string[]>; message?: string }
  >;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formats a Brazilian phone number from E.164 to display format.
 * E.g. "+5511987654321" → "+55 11 98765-4321"
 */
function formatPhoneDisplay(phone: string): string {
  // Match +55 + 2-digit DDD + 5-digit prefix + 4-digit suffix
  const match = phone.match(/^\+(\d{2})(\d{2})(\d{5})(\d{4})$/);
  if (match) {
    return `+${match[1]} ${match[2]} ${match[3]}-${match[4]}`;
  }
  // Fallback: return as-is if format does not match
  return phone;
}

/**
 * Formats a connection date for display.
 * E.g. "Conectado em 15 mai. 2026"
 */
function formatConnectedDate(date: Date | string | null): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return `Conectado em ${format(d, 'd MMM. yyyy', { locale: ptBR })}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WhatsappAccountCard({
  account,
  onDisconnect,
  onStartConnection,
  onCompleteConnection,
}: WhatsappAccountCardProps) {
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [isDisconnecting, startDisconnectTransition] = useTransition();

  const status = account?.status ?? 'disconnected';
  const isConnected = status === 'active';
  const isError = status === 'error';
  const isDisconnected = !account || status === 'disconnected';

  function handleDisconnect() {
    startDisconnectTransition(async () => {
      const result = await onDisconnect();
      if (result.ok) {
        setDisconnectDialogOpen(false);
        toast.success('WhatsApp desconectado com sucesso.');
      } else {
        toast.error('Erro ao desconectar WhatsApp. Tente novamente.');
      }
    });
  }

  function handleConnectionComplete() {
    setConnectDialogOpen(false);
    toast.success('WhatsApp conectado com sucesso.');
  }

  return (
    <>
      <Card data-testid="whatsapp-account-card">
        <CardHeader>
          <div className="flex items-center gap-3">
            <MessageCircle className="text-text-tertiary h-6 w-6 shrink-0" aria-hidden="true" />
            <h3 className="text-text-primary text-[18px] leading-[1.25] font-semibold">
              Integracao WhatsApp
            </h3>
          </div>
        </CardHeader>

        <CardContent>
          {/* ----- Connected state ----- */}
          {isConnected && account && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Badge variant="success" data-testid="whatsapp-status-badge">
                  Conectado
                </Badge>
                <p className="text-text-primary text-[15px] font-medium">
                  {formatPhoneDisplay(account.phoneNumber)}
                </p>
                {account.displayName && (
                  <p className="text-text-secondary text-[13px]">{account.displayName}</p>
                )}
                {account.connectedAt && (
                  <p className="text-text-tertiary text-[12px] font-medium">
                    {formatConnectedDate(account.connectedAt)}
                  </p>
                )}
              </div>

              <AlertDialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" data-testid="whatsapp-disconnect-button">
                    Desconectar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Desconectar WhatsApp?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Templates serao preservados, mas lembretes deixarao de ser enviados.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDisconnecting}>Cancelar</AlertDialogCancel>
                    <Button
                      variant="destructive"
                      onClick={handleDisconnect}
                      disabled={isDisconnecting}
                      data-testid="whatsapp-disconnect-confirm-button"
                    >
                      {isDisconnecting && (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      )}
                      Desconectar
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          {/* ----- Error state ----- */}
          {isError && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Badge variant="danger" data-testid="whatsapp-status-badge">
                  Erro de conexao
                </Badge>
                <p className="text-text-secondary text-[15px]">
                  Houve um problema com a conexao do WhatsApp. Reconecte para voltar a enviar
                  lembretes.
                </p>
              </div>
              <Button
                onClick={() => setConnectDialogOpen(true)}
                data-testid="whatsapp-reconnect-button"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                Reconectar
              </Button>
            </div>
          )}

          {/* ----- Disconnected / no account state ----- */}
          {isDisconnected && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Badge variant="neutral" data-testid="whatsapp-status-badge">
                  Nao conectado
                </Badge>
                <p className="text-text-secondary text-[15px]">
                  Conecte seu WhatsApp para enviar lembretes automaticos de sessao aos seus
                  pacientes.
                </p>
              </div>
              <Button
                onClick={() => setConnectDialogOpen(true)}
                data-testid="whatsapp-connect-button"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                Conectar WhatsApp
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ConnectWhatsappDialog
        open={connectDialogOpen}
        onOpenChange={setConnectDialogOpen}
        onStartConnection={onStartConnection}
        onCompleteConnection={onCompleteConnection}
        onSuccess={handleConnectionComplete}
      />
    </>
  );
}
