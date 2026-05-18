'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import type {
  RemovePersonalNotesPasswordResult,
  SetPersonalNotesPasswordResult,
} from '@/modules/medical-records';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type SheetMode = 'set' | 'remove';

interface PersonalNotesPasswordSheetProps {
  /** Whether the sheet is open. */
  open: boolean;
  /** Callback to toggle the sheet. */
  onOpenChange: (open: boolean) => void;
  /** Current mode: 'set' to create/change password, 'remove' to delete it. */
  mode: SheetMode;
  /** Patient UUID. */
  patientId: string;
  /** Server action: set a new password. */
  setPassword: (input: {
    patientId: string;
    newPassword: string;
  }) => Promise<SetPersonalNotesPasswordResult>;
  /** Server action: remove the existing password. */
  removePassword: (input: {
    patientId: string;
    currentPassword: string;
  }) => Promise<RemovePersonalNotesPasswordResult>;
  /** Callback on successful password change (set or remove). */
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Minimum password length (mirrors server schema)
// ---------------------------------------------------------------------------

const MIN_PASSWORD_LENGTH = 6;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Sheet for setting or removing the personal notes privacy password.
 *
 * Two modes:
 * - "set": new password + confirm + no-recovery warning.
 * - "remove": current password + confirm button.
 *
 * Uses Sonner toasts on success.
 */
export function PersonalNotesPasswordSheet({
  open,
  onOpenChange,
  mode,
  patientId,
  setPassword,
  removePassword,
  onSuccess,
}: PersonalNotesPasswordSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" data-testid="personal-notes-password-sheet">
        <SheetHeader>
          <SheetTitle>
            {mode === 'set' ? 'Configurar senha extra' : 'Remover senha extra'}
          </SheetTitle>
          <SheetDescription>
            {mode === 'set'
              ? 'Adicione uma senha para proteger suas notas pessoais neste prontuario.'
              : 'Remova a senha de protecao das notas pessoais.'}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6">
          {mode === 'set' ? (
            <SetPasswordForm
              patientId={patientId}
              setPassword={setPassword}
              onSuccess={() => {
                onOpenChange(false);
                onSuccess();
              }}
            />
          ) : (
            <RemovePasswordForm
              patientId={patientId}
              removePassword={removePassword}
              onSuccess={() => {
                onOpenChange(false);
                onSuccess();
              }}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// SetPasswordForm (internal)
// ---------------------------------------------------------------------------

interface SetPasswordFormProps {
  patientId: string;
  setPassword: PersonalNotesPasswordSheetProps['setPassword'];
  onSuccess: () => void;
}

function SetPasswordForm({ patientId, setPassword, onSuccess }: SetPasswordFormProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const validate = useCallback((): string | null => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return `A senha deve ter no minimo ${MIN_PASSWORD_LENGTH} caracteres.`;
    }
    if (newPassword !== confirmPassword) {
      return 'As senhas nao coincidem.';
    }
    return null;
  }, [newPassword, confirmPassword]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const validationError = validate();
      if (validationError) {
        setError(validationError);
        return;
      }

      setError(null);
      setSubmitting(true);

      const result = await setPassword({ patientId, newPassword });
      setSubmitting(false);

      if (result.ok) {
        toast.success('Senha configurada com sucesso.');
        setNewPassword('');
        setConfirmPassword('');
        onSuccess();
      } else if (result.code === 'WEAK_PASSWORD') {
        setError(`A senha deve ter no minimo ${MIN_PASSWORD_LENGTH} caracteres.`);
      } else {
        toast.error('Erro ao configurar senha. Tente novamente.');
      }
    },
    [validate, patientId, newPassword, setPassword, onSuccess],
  );

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
      {/* No-recovery warning */}
      <Alert variant="default" data-testid="password-no-recovery-warning">
        <AlertDescription>
          Se voce esquecer esta senha, nao sera possivel recupera-la automaticamente.
        </AlertDescription>
      </Alert>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">Nova senha</Label>
        <Input
          id="new-password"
          type="password"
          value={newPassword}
          onChange={(e) => {
            setNewPassword(e.target.value);
            setError(null);
          }}
          placeholder="Minimo 6 caracteres"
          disabled={submitting}
          data-testid="password-new-input"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm-password">Confirmar senha</Label>
        <Input
          id="confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            setError(null);
          }}
          placeholder="Repita a senha"
          disabled={submitting}
          data-testid="password-confirm-input"
        />
      </div>

      {error && (
        <p className="text-danger-700 text-sm" data-testid="password-form-error">
          {error}
        </p>
      )}

      <Button type="submit" disabled={submitting} data-testid="password-set-submit">
        {submitting ? 'Salvando...' : 'Configurar senha'}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// RemovePasswordForm (internal)
// ---------------------------------------------------------------------------

interface RemovePasswordFormProps {
  patientId: string;
  removePassword: PersonalNotesPasswordSheetProps['removePassword'];
  onSuccess: () => void;
}

function RemovePasswordForm({ patientId, removePassword, onSuccess }: RemovePasswordFormProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!currentPassword.trim()) {
        setError('Digite a senha atual.');
        return;
      }

      setError(null);
      setSubmitting(true);

      const result = await removePassword({ patientId, currentPassword });
      setSubmitting(false);

      if (result.ok) {
        toast.success('Senha removida com sucesso.');
        setCurrentPassword('');
        onSuccess();
      } else if (result.code === 'WRONG_PASSWORD') {
        setError('Senha incorreta.');
      } else if (result.code === 'LOCKED') {
        setError('Bloqueado por tentativas incorretas. Tente novamente mais tarde.');
      } else {
        toast.error('Erro ao remover senha. Tente novamente.');
      }
    },
    [currentPassword, patientId, removePassword, onSuccess],
  );

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="current-password">Senha atual</Label>
        <Input
          id="current-password"
          type="password"
          value={currentPassword}
          onChange={(e) => {
            setCurrentPassword(e.target.value);
            setError(null);
          }}
          placeholder="Digite a senha atual"
          disabled={submitting}
          data-testid="password-current-input"
        />
      </div>

      {error && (
        <p className="text-danger-700 text-sm" data-testid="password-remove-error">
          {error}
        </p>
      )}

      <Button
        type="submit"
        variant="destructive"
        disabled={submitting || !currentPassword.trim()}
        data-testid="password-remove-submit"
      >
        {submitting ? 'Removendo...' : 'Remover senha'}
      </Button>
    </form>
  );
}
