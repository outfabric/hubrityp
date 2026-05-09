'use client';

import {
  Archive,
  Check,
  Copy,
  Link as LinkIcon,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import type { ConsentStatus, GenerateConsentResult, RevokeConsentResult } from '@/modules/patients';
import type { Patient, PatientGuardian } from '@/shared/db/schema/patients/tables';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip';

import { ArchiveConfirmModal } from './archive-confirm-modal';
import { DeleteConfirmModal } from './delete-confirm-modal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

/** Extracts digits from a phone string for building a wa.me link. */
function extractPhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Calculates age from a birth date. Returns `null` when no date is provided.
 */
function calculateAge(birthDate: Date | null): number | null {
  if (!birthDate) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

function statusBadgeVariant(status: string) {
  if (status === 'active') return 'success' as const;
  return 'neutral' as const;
}

function statusLabel(status: string) {
  if (status === 'active') return 'Ativo';
  return 'Arquivado';
}

// ---------------------------------------------------------------------------
// Consent helpers
// ---------------------------------------------------------------------------

/** Badge variant and label for each consent status. */
function consentBadgeConfig(status: ConsentStatus) {
  switch (status) {
    case 'signed':
      return { variant: 'success' as const, label: 'Consentimento assinado' };
    case 'revoked':
      return { variant: 'danger' as const, label: 'Consentimento revogado' };
    case 'pending':
    default:
      return { variant: 'warning' as const, label: 'Consentimento pendente' };
  }
}

/**
 * Builds a `wa.me` consent link with pre-filled message.
 * For minors, uses the primary guardian's phone.
 */
function buildConsentWhatsAppHref(phone: string, consentUrl: string): string {
  const digits = extractPhoneDigits(phone);
  const message = encodeURIComponent(
    `Olá! Segue o link para assinatura do termo de consentimento: ${consentUrl}`,
  );
  return `https://wa.me/${digits}?text=${message}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PatientDetailHeaderProps {
  patient: Patient;
  /** Signed URL for the patient photo (if available). */
  photoUrl?: string;
  /** Current consent status for badge display. */
  consentStatus: ConsentStatus;
  /** Existing pending consent token (if any). */
  consentToken: string | null;
  /** Primary guardian for minors (used for WhatsApp consent link). */
  primaryGuardian?: PatientGuardian;
  /** Server Action to archive the patient. */
  archiveAction: (patientId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Server Action to unarchive the patient. */
  unarchiveAction: (patientId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Server Action to delete the patient. */
  deleteAction: (patientId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Server Action to generate a new consent term (returns token). */
  generateConsentAction: (patientId: string) => Promise<GenerateConsentResult>;
  /** Server Action to revoke the active consent. */
  revokeConsentAction: (patientId: string) => Promise<RevokeConsentResult>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PatientDetailHeader({
  patient,
  photoUrl,
  consentStatus,
  consentToken,
  primaryGuardian,
  archiveAction,
  unarchiveAction,
  deleteAction,
  generateConsentAction,
  revokeConsentAction,
}: PatientDetailHeaderProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [revokeModalOpen, setRevokeModalOpen] = useState(false);

  const age = calculateAge(patient.birthDate);
  const ageDisplay =
    age !== null
      ? `${age} anos`
      : patient.approximateAge
        ? `~${patient.approximateAge} anos`
        : null;

  const whatsappHref = patient.phone
    ? `https://wa.me/${extractPhoneDigits(patient.phone)}`
    : undefined;

  const isMinor = patient.patientType === 'child' || patient.patientType === 'adolescent';

  // Phone for consent WhatsApp: use guardian phone for minors, patient phone otherwise
  const consentWhatsAppPhone = isMinor ? (primaryGuardian?.phone ?? null) : (patient.phone ?? null);

  const handleCopyEmail = () => {
    if (!patient.email) return;
    void navigator.clipboard.writeText(patient.email).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  /**
   * Resolves a consent token — reuses an existing pending one or generates a
   * new term via the server action when none exists.
   */
  const resolveConsentToken = async (): Promise<string | null> => {
    if (consentToken) return consentToken;
    const result = await generateConsentAction(patient.id);
    if (result.ok) return result.token;
    toast.error('Erro ao gerar o termo de consentimento');
    return null;
  };

  const buildConsentUrl = (token: string) => {
    return `${window.location.origin}/termo/${token}`;
  };

  const handleCopyConsentLink = () => {
    startTransition(async () => {
      const token = await resolveConsentToken();
      if (!token) return;
      const url = buildConsentUrl(token);
      await navigator.clipboard.writeText(url);
      toast.success('Link do termo copiado', { duration: 4000 });
    });
  };

  const handleSendConsentWhatsApp = () => {
    if (!consentWhatsAppPhone) return;
    startTransition(async () => {
      const token = await resolveConsentToken();
      if (!token) return;
      const url = buildConsentUrl(token);
      const href = buildConsentWhatsAppHref(consentWhatsAppPhone, url);
      window.open(href, '_blank', 'noopener,noreferrer');
    });
  };

  const handleRevokeConfirm = () => {
    startTransition(async () => {
      const result = await revokeConsentAction(patient.id);
      if (result.ok) {
        toast.success('Consentimento revogado');
      } else if ('message' in result) {
        toast.error(result.message);
      } else {
        toast.error('Erro ao revogar o consentimento');
      }
      setRevokeModalOpen(false);
      router.refresh();
    });
  };

  const handleArchiveConfirm = () => {
    startTransition(async () => {
      if (patient.status === 'active') {
        const result = await archiveAction(patient.id);
        if (result.ok) {
          toast.success('Paciente arquivado');
        }
      } else {
        const result = await unarchiveAction(patient.id);
        if (result.ok) {
          toast.success('Paciente desarquivado');
        }
      }
      setArchiveModalOpen(false);
      router.refresh();
    });
  };

  const handleDeleteConfirm = () => {
    startTransition(async () => {
      const result = await deleteAction(patient.id);
      if (result.ok) {
        toast.success('Paciente excluido');
        router.push('/pacientes');
      }
      setDeleteModalOpen(false);
    });
  };

  const consentBadge = consentBadgeConfig(consentStatus);

  return (
    <div
      className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
      data-testid="patient-detail-header"
    >
      {/* Left: Avatar + Info */}
      <div className="flex items-start gap-4">
        <Avatar className="h-14 w-14" data-testid="patient-avatar">
          {photoUrl ? <AvatarImage src={photoUrl} alt={patient.fullName} /> : null}
          <AvatarFallback className="text-base">{getInitials(patient.fullName)}</AvatarFallback>
        </Avatar>

        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1
              className="text-text-primary text-[28px] leading-[1.25] font-semibold"
              data-testid="patient-name"
            >
              {patient.fullName}
            </h1>
            <Badge variant={statusBadgeVariant(patient.status)} data-testid="patient-status-badge">
              {statusLabel(patient.status)}
            </Badge>
            <Badge variant={consentBadge.variant} data-testid="consent-status-badge">
              {consentBadge.label}
            </Badge>
          </div>

          {ageDisplay && (
            <span className="text-text-secondary text-[13px]" data-testid="patient-age">
              {ageDisplay}
            </span>
          )}

          {/* Tags */}
          {patient.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1" data-testid="patient-tags">
              {patient.tags.map((tag) => (
                <Badge key={tag} variant="neutral">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {/* Contact actions */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {whatsappHref && (
              <Button variant="ghost" size="sm" asChild data-testid="patient-whatsapp-button">
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  Abrir no WhatsApp
                </a>
              </Button>
            )}

            {patient.email && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopyEmail}
                      data-testid="patient-copy-email-button"
                      aria-label={`Copiar e-mail ${patient.email}`}
                    >
                      {copied ? (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      )}
                      {patient.email}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{copied ? 'Copiado!' : 'Copiar e-mail'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {/* Consent actions */}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {consentWhatsAppPhone && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSendConsentWhatsApp}
                disabled={isPending}
                data-testid="consent-whatsapp-button"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                Enviar termo por WhatsApp
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyConsentLink}
              disabled={isPending}
              data-testid="consent-copy-link-button"
            >
              <LinkIcon className="h-4 w-4" aria-hidden="true" />
              Copiar link
            </Button>
          </div>
        </div>
      </div>

      {/* Right: Actions menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            aria-label="Mais opcoes"
            data-testid="patient-actions-menu"
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => router.push(`/pacientes/${patient.id}/editar`)}
            data-testid="patient-action-edit"
          >
            <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
            Editar
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setArchiveModalOpen(true)}
            data-testid="patient-action-archive"
          >
            <Archive className="mr-2 h-4 w-4" aria-hidden="true" />
            {patient.status === 'active' ? 'Arquivar' : 'Desarquivar'}
          </DropdownMenuItem>
          {consentStatus === 'signed' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setRevokeModalOpen(true)}
                className="text-danger-700 focus:text-danger-700"
                data-testid="patient-action-revoke-consent"
              >
                <ShieldOff className="mr-2 h-4 w-4" aria-hidden="true" />
                Revogar consentimento
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setDeleteModalOpen(true)}
            className="text-danger-700 focus:text-danger-700"
            data-testid="patient-action-delete"
          >
            <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Archive confirmation modal */}
      <ArchiveConfirmModal
        open={archiveModalOpen}
        onOpenChange={setArchiveModalOpen}
        onConfirm={handleArchiveConfirm}
        isPending={isPending}
      />

      {/* Delete confirmation modal */}
      <DeleteConfirmModal
        open={deleteModalOpen}
        onOpenChange={setDeleteModalOpen}
        onConfirm={handleDeleteConfirm}
        isPending={isPending}
      />

      {/* Revoke consent confirmation dialog */}
      <AlertDialog open={revokeModalOpen} onOpenChange={setRevokeModalOpen}>
        <AlertDialogContent data-testid="revoke-consent-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle asChild>
              <h3>Revogar consentimento?</h3>
            </AlertDialogTitle>
            <AlertDialogDescription>
              Ao revogar o consentimento, o termo assinado sera invalidado e o paciente precisara
              assinar um novo termo antes de continuar o tratamento. Esta acao nao pode ser
              desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending} data-testid="revoke-consent-cancel">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevokeConfirm}
              disabled={isPending}
              className="bg-danger-500 text-text-inverse hover:bg-danger-700"
              data-testid="revoke-consent-confirm"
            >
              Revogar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
