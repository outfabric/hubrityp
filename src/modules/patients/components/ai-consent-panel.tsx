'use client';

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Copy, Lock, Mail, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';

import type {
  AiConsentStatusView,
  GenerateAiConsentResult,
  GetAiConsentStatusResult,
  RevokeAiConsentResult,
} from '../lib/ai-consent-schemas';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AI_CONSENT_QUERY_KEY = 'ai-consent';
const REVOKE_CONFIRMATION_WORD = 'REVOGAR';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AiConsentPanelProps {
  patientId: string;
  /** Server Action to fetch the current AI consent status. */
  getStatusAction: (patientId: string) => Promise<GetAiConsentStatusResult>;
  /** Server Action to generate a new AI consent term. */
  generateAction: (patientId: string) => Promise<GenerateAiConsentResult>;
  /** Server Action to revoke the active AI consent. */
  revokeAction: (patientId: string, reason: string | null) => Promise<RevokeAiConsentResult>;
}

// ---------------------------------------------------------------------------
// Internal component (expects QueryClientProvider above it)
// ---------------------------------------------------------------------------

function AiConsentPanelInner({
  patientId,
  getStatusAction,
  generateAction,
  revokeAction,
}: AiConsentPanelProps) {
  const qc = useQueryClient();
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [revokeInput, setRevokeInput] = useState('');
  const linkInputRef = useRef<HTMLInputElement>(null);

  // ---- Query: AI consent status -------------------------------------------

  const {
    data: consentStatus,
    isLoading,
    isError,
  } = useQuery<AiConsentStatusView>({
    queryKey: [AI_CONSENT_QUERY_KEY, patientId],
    queryFn: async () => {
      const result = await getStatusAction(patientId);
      if (!result.ok) {
        throw new Error(result.error);
      }
      return result.consent;
    },
  });

  // ---- Mutation: Generate consent term ------------------------------------

  const generateMutation = useMutation<
    GenerateAiConsentResult,
    Error,
    void,
    { previousStatus: AiConsentStatusView | undefined }
  >({
    mutationFn: async () => {
      return generateAction(patientId);
    },
    onMutate: () => {
      const previousStatus = consentStatus;
      return { previousStatus };
    },
    onSuccess: (result) => {
      if (result.ok) {
        toast.success('Termo de consentimento gerado com sucesso');
      } else if (result.error === 'ALREADY_ACTIVE') {
        toast.error('Já existe um termo ativo ou pendente para este paciente');
      } else {
        toast.error('Erro ao gerar o termo de consentimento');
      }
    },
    onError: () => {
      toast.error('Erro ao gerar o termo de consentimento');
    },
    onSettled: async () => {
      await qc.invalidateQueries({
        queryKey: [AI_CONSENT_QUERY_KEY, patientId],
      });
    },
  });

  // ---- Mutation: Revoke consent term --------------------------------------

  const revokeMutation = useMutation<
    RevokeAiConsentResult,
    Error,
    void,
    { previousStatus: AiConsentStatusView | undefined }
  >({
    mutationFn: async () => {
      return revokeAction(patientId, null);
    },
    onMutate: () => {
      const previousStatus = consentStatus;
      return { previousStatus };
    },
    onSuccess: (result) => {
      if (result.ok) {
        toast.success('Termo de consentimento revogado');
        setRevokeDialogOpen(false);
        setRevokeInput('');
      } else {
        toast.error('Erro ao revogar o termo de consentimento');
      }
    },
    onError: () => {
      toast.error('Erro ao revogar o termo de consentimento');
    },
    onSettled: async () => {
      await qc.invalidateQueries({
        queryKey: [AI_CONSENT_QUERY_KEY, patientId],
      });
    },
  });

  // ---- Handlers -----------------------------------------------------------

  const handleCopyLink = () => {
    if (consentStatus?.state !== 'pending') return;
    const url = `${window.location.origin}${consentStatus.publicUrl}`;
    void navigator.clipboard.writeText(url).then(() => {
      toast.success('Link copiado');
    });
  };

  const handleResend = () => {
    if (consentStatus?.state !== 'pending') return;
    const url = `${window.location.origin}${consentStatus.publicUrl}`;
    const subject = encodeURIComponent('Termo de consentimento — Transcrição IA');
    const body = encodeURIComponent(
      `Olá! Segue o link para assinatura do termo de consentimento para transcrição por IA: ${url}`,
    );
    window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
  };

  const handleRevokeConfirm = () => {
    if (revokeInput !== REVOKE_CONFIRMATION_WORD) return;
    revokeMutation.mutate();
  };

  const handleRevokeDialogChange = (open: boolean) => {
    setRevokeDialogOpen(open);
    if (!open) {
      setRevokeInput('');
    }
  };

  // ---- Format helpers -----------------------------------------------------

  const formatDate = (date: Date) => {
    return format(new Date(date), 'dd/MM/yyyy', { locale: ptBR });
  };

  // ---- Loading / Error states ---------------------------------------------

  if (isLoading) {
    return (
      <Card data-testid="ai-consent-panel">
        <CardHeader>
          <CardTitle>
            <h3 className="flex items-center gap-2">
              <Sparkles className="text-brand-500 h-5 w-5" aria-hidden="true" />
              Transcrição IA
            </h3>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-secondary text-[13px]">Carregando...</p>
        </CardContent>
      </Card>
    );
  }

  if (isError || !consentStatus) {
    return (
      <Card data-testid="ai-consent-panel">
        <CardHeader>
          <CardTitle>
            <h3 className="flex items-center gap-2">
              <Sparkles className="text-brand-500 h-5 w-5" aria-hidden="true" />
              Transcrição IA
            </h3>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-secondary text-[13px]">
            Erro ao carregar o status do consentimento.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ---- Render per state ---------------------------------------------------

  return (
    <>
      <Card data-testid="ai-consent-panel">
        <CardHeader className="p-6 max-sm:p-4">
          <CardTitle>
            <h3 className="flex items-center gap-2">
              <Sparkles className="text-brand-500 h-5 w-5" aria-hidden="true" />
              Transcrição IA
              {consentStatus.state === 'active' && (
                <Badge variant="success" data-testid="ai-consent-badge">
                  Vigente
                </Badge>
              )}
              {consentStatus.state === 'revoked' && (
                <Badge variant="warning" data-testid="ai-consent-badge">
                  Revogado em {formatDate(consentStatus.revokedAt)}
                </Badge>
              )}
            </h3>
          </CardTitle>
        </CardHeader>

        <CardContent className="p-6 pt-0 max-sm:p-4 max-sm:pt-0">
          {/* State: none */}
          {consentStatus.state === 'none' && (
            <div className="flex flex-col gap-4">
              <p className="text-text-secondary text-[15px]">
                A transcrição por IA permite gerar notas clínicas automaticamente a partir das
                sessões gravadas. Para utilizar este recurso, o paciente precisa assinar um termo de
                consentimento.
              </p>
              <div>
                <Button
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                  data-testid="ai-consent-generate-btn"
                >
                  Gerar termo de consentimento
                </Button>
              </div>
            </div>
          )}

          {/* State: pending */}
          {consentStatus.state === 'pending' && (
            <div className="flex flex-col gap-4">
              <p className="text-text-secondary text-[13px]">
                Aguardando assinatura — expira em {formatDate(consentStatus.expiresAt)}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  ref={linkInputRef}
                  readOnly
                  value={`${typeof window !== 'undefined' ? window.location.origin : ''}${consentStatus.publicUrl}`}
                  className="flex-1"
                  aria-label="Link do termo de consentimento"
                  data-testid="ai-consent-link-input"
                />
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={handleCopyLink}
                    aria-label="Copiar link do termo"
                    data-testid="ai-consent-copy-btn"
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    Copiar link
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleResend}
                    aria-label="Reenviar termo por e-mail"
                    data-testid="ai-consent-resend-btn"
                  >
                    <Mail className="h-4 w-4" aria-hidden="true" />
                    Reenviar
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* State: active */}
          {consentStatus.state === 'active' && (
            <div className="flex flex-col gap-4">
              <p className="text-text-secondary text-[13px]">
                Assinado em {formatDate(consentStatus.signedAt)}
              </p>
              <div>
                <Button
                  variant="destructive"
                  onClick={() => setRevokeDialogOpen(true)}
                  data-testid="ai-consent-revoke-btn"
                >
                  <Lock className="h-4 w-4" aria-hidden="true" />
                  Revogar termo
                </Button>
              </div>
            </div>
          )}

          {/* State: revoked */}
          {consentStatus.state === 'revoked' && (
            <div className="flex flex-col gap-4">
              <p className="text-text-secondary text-[13px]">
                Termo revogado em {formatDate(consentStatus.revokedAt)}.
              </p>
              <div>
                <Button
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                  data-testid="ai-consent-generate-btn"
                >
                  Gerar novo termo
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revoke confirmation dialog */}
      <AlertDialog open={revokeDialogOpen} onOpenChange={handleRevokeDialogChange}>
        <AlertDialogContent data-testid="ai-consent-revoke-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle asChild>
              <h3>Revogar termo de consentimento?</h3>
            </AlertDialogTitle>
            <AlertDialogDescription>
              Ao revogar o termo, a transcrição por IA será desativada para este paciente. Esta ação
              não pode ser desfeita. Para confirmar, digite{' '}
              <strong className="text-text-primary">{REVOKE_CONFIRMATION_WORD}</strong> abaixo.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-2">
            <Input
              value={revokeInput}
              onChange={(e) => setRevokeInput(e.target.value.toUpperCase())}
              placeholder={`Digite ${REVOKE_CONFIRMATION_WORD} para confirmar`}
              aria-label={`Digite ${REVOKE_CONFIRMATION_WORD} para confirmar a revogação`}
              data-testid="ai-consent-revoke-input"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={revokeMutation.isPending}
              data-testid="ai-consent-revoke-cancel"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevokeConfirm}
              disabled={revokeInput !== REVOKE_CONFIRMATION_WORD || revokeMutation.isPending}
              className="bg-danger-500 text-text-inverse hover:bg-danger-700"
              data-testid="ai-consent-revoke-confirm"
            >
              Revogar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Public component — creates a dedicated QueryClient per mount so each
// panel instance (and each test render) gets an isolated cache. The
// useState initialiser runs once; React keeps the same client across
// re-renders while the component stays mounted.
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  });
}

export function AiConsentPanel(props: AiConsentPanelProps) {
  const [client] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={client}>
      <AiConsentPanelInner {...props} />
    </QueryClientProvider>
  );
}
