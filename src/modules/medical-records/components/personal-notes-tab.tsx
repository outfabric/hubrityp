'use client';

import { Info, Lock } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  GetPersonalNotesResult,
  RemovePersonalNotesPasswordResult,
  SetPersonalNotesPasswordResult,
  UpsertPersonalNotesResult,
} from '@/modules/medical-records';
import { TiptapEditor } from '@/modules/patients/components/tiptap-editor';
import { useAutoSave } from '@/modules/patients/lib/use-auto-save';
import { Button } from '@/shared/ui/button';

import { AutoSaveIndicator } from './auto-save-indicator';
import { PersonalNotesLock } from './personal-notes-lock';
import { PersonalNotesPasswordSheet } from './personal-notes-password-sheet';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PersonalNotesTabProps {
  /** Patient UUID. */
  patientId: string;
  /** Server action: get personal notes (with optional password). */
  getPersonalNotes: (input: {
    patientId: string;
    password?: string;
  }) => Promise<GetPersonalNotesResult>;
  /** Server action: upsert personal notes content. */
  upsertPersonalNotes: (input: {
    patientId: string;
    content: string;
  }) => Promise<UpsertPersonalNotesResult>;
  /** Server action: set a new password on personal notes. */
  setPersonalNotesPassword: (input: {
    patientId: string;
    newPassword: string;
  }) => Promise<SetPersonalNotesPasswordResult>;
  /** Server action: remove the existing password. */
  removePersonalNotesPassword: (input: {
    patientId: string;
    currentPassword: string;
  }) => Promise<RemovePersonalNotesPasswordResult>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Main container for the "Notas" prontuario tab.
 *
 * Security: when a password is set and the session has not been unlocked,
 * content is NOT loaded from the server. Only metadata (hasPassword, isLocked,
 * remainingAttempts) is fetched. Content is loaded only after successful
 * password verification via getPersonalNotes(password).
 *
 * Once unlocked in this session, the unlocked state persists in React state
 * (not persisted across page reloads — by design, per Decision #6).
 */
export function PersonalNotesTab({
  patientId,
  getPersonalNotes,
  upsertPersonalNotes,
  setPersonalNotesPassword,
  removePersonalNotesPassword,
}: PersonalNotesTabProps) {
  // Session-level unlock state (not persisted)
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);

  // Notes metadata from server
  const [hasPassword, setHasPassword] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [lockedUntilIso, setLockedUntilIso] = useState<string | null>(null);
  // Content state (populated only when unlocked)
  const [content, setContent] = useState<string>('');

  // Unlock state
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // Password sheet state
  const [passwordSheetOpen, setPasswordSheetOpen] = useState(false);
  const [passwordSheetMode, setPasswordSheetMode] = useState<'set' | 'remove'>('set');

  // Track if the initial load has been done to avoid double-fetching
  const initialLoadDone = useRef(false);

  // Fetch notes metadata / content on mount
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    void (async () => {
      setLoading(true);
      const result = await getPersonalNotes({ patientId });

      if (result.ok) {
        setHasPassword(result.hasPassword);
        setIsLocked(result.isLocked);
        setLockedUntilIso(result.lockedUntilIso ?? null);
        // If no password or not password-protected, content is available
        if (!result.hasPassword) {
          setContent(result.content ?? '');
          setUnlocked(true);
        }
      } else if (result.code === 'LOCKED') {
        setHasPassword(true);
        setIsLocked(true);
        setLockedUntilIso(result.lockedUntilIso ?? null);
      }

      setLoading(false);
    })();
  }, [patientId, getPersonalNotes]);

  // Unlock handler — calls getPersonalNotes with password
  const handleUnlock = useCallback(
    async (password: string) => {
      setIsUnlocking(true);
      setUnlockError(null);

      const result = await getPersonalNotes({ patientId, password });

      if (result.ok) {
        setContent(result.content ?? '');
        setUnlocked(true);
        setHasPassword(result.hasPassword);
        setIsLocked(false);
        setLockedUntilIso(null);
      } else if (result.code === 'WRONG_PASSWORD') {
        const remaining = result.remainingAttempts ?? 0;
        setUnlockError(`Senha incorreta. Tentativas restantes: ${remaining}`);
      } else if (result.code === 'LOCKED') {
        setIsLocked(true);
        setLockedUntilIso(result.lockedUntilIso ?? null);
        setUnlockError(null);
      }

      setIsUnlocking(false);
    },
    [patientId, getPersonalNotes],
  );

  // Auto-save handler for upsert
  const handleSave = useCallback(
    async (contentToSave: string) => {
      await upsertPersonalNotes({ patientId, content: contentToSave });
    },
    [patientId, upsertPersonalNotes],
  );

  const {
    status: saveStatus,
    lastSavedAt,
    isDirty,
    saveNow,
  } = useAutoSave(content, handleSave, {
    interval: 10_000,
  });

  // Password sheet success handler — refresh metadata
  const handlePasswordChangeSuccess = useCallback(async () => {
    const result = await getPersonalNotes({ patientId });

    if (result.ok) {
      setHasPassword(result.hasPassword);
      setIsLocked(result.isLocked);

      // If password was removed, notes remain accessible
      if (!result.hasPassword) {
        setContent(result.content ?? '');
        setUnlocked(true);
      }
    }
  }, [patientId, getPersonalNotes]);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="personal-notes-loading">
        <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="personal-notes-tab">
      {/* Regulatory banner */}
      <div
        className="bg-warning-50 text-warning-700 flex items-start gap-3 rounded-lg p-4"
        role="note"
        data-testid="personal-notes-banner"
      >
        <Lock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="text-sm">
          Estas notas são pessoais do(a) psicólogo(a) e NÃO fazem parte do prontuário oficial que o
          paciente pode acessar (Resolução CFP 001/2009, art. 5).
        </p>
      </div>

      {/* Lock screen or editor */}
      {hasPassword && !unlocked ? (
        <PersonalNotesLock
          lockedUntilIso={isLocked ? lockedUntilIso : null}
          isUnlocking={isUnlocking}
          error={unlockError}
          onUnlock={(password) => void handleUnlock(password)}
        />
      ) : (
        <>
          {/* Auto-save indicator + manual save button */}
          <div className="flex items-center gap-3">
            <AutoSaveIndicator status={saveStatus} lastSavedAt={lastSavedAt} />
            <Button
              type="button"
              size="sm"
              disabled={!isDirty || saveStatus === 'saving'}
              onClick={() => {
                void saveNow();
              }}
              data-testid="personal-notes-save-button"
            >
              Salvar
            </Button>
          </div>

          {/* Tiptap editor — same config as evolutions */}
          <div className="max-w-[720px]">
            <TiptapEditor
              content={content}
              onChange={setContent}
              placeholder="Escreva suas notas pessoais..."
              aria-label="Notas pessoais"
            />
          </div>

          {/* Footer: password management + export info */}
          <div className="flex flex-col gap-3">
            {/* Password management links */}
            <div className="flex gap-4">
              {hasPassword ? (
                <button
                  type="button"
                  className="text-brand-700 text-sm font-medium hover:underline"
                  onClick={() => {
                    setPasswordSheetMode('remove');
                    setPasswordSheetOpen(true);
                  }}
                  data-testid="personal-notes-remove-password"
                >
                  Remover senha extra
                </button>
              ) : (
                <button
                  type="button"
                  className="text-brand-700 text-sm font-medium hover:underline"
                  onClick={() => {
                    setPasswordSheetMode('set');
                    setPasswordSheetOpen(true);
                  }}
                  data-testid="personal-notes-set-password"
                >
                  Configurar senha extra
                </button>
              )}
            </div>

            {/* Export exclusion info note */}
            <div
              className="text-text-secondary flex items-start gap-2 text-sm"
              data-testid="personal-notes-export-info"
            >
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                Estas notas NÃO entram na exportação padrão. Para incluir explicitamente, marque a
                opção ao exportar.
              </p>
            </div>
          </div>
        </>
      )}

      {/* Password sheet */}
      <PersonalNotesPasswordSheet
        open={passwordSheetOpen}
        onOpenChange={setPasswordSheetOpen}
        mode={passwordSheetMode}
        patientId={patientId}
        setPassword={setPersonalNotesPassword}
        removePassword={removePersonalNotesPassword}
        onSuccess={() => void handlePasswordChangeSuccess()}
      />
    </div>
  );
}
