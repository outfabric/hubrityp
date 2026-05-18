'use client';

import { Lock } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Computes the countdown text from a lockout ISO timestamp, or null if not locked. */
function computeCountdown(lockedUntilIso: string | null): string | null {
  if (!lockedUntilIso) return null;

  const lockedUntil = new Date(lockedUntilIso).getTime();
  const now = Date.now();
  const remainingMs = lockedUntil - now;

  if (remainingMs <= 0) return null;

  const remainingMinutes = Math.ceil(remainingMs / 60_000);
  return `Bloqueado por ${remainingMinutes} ${remainingMinutes === 1 ? 'minuto' : 'minutos'}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PersonalNotesLockProps {
  /** ISO timestamp until which the notes are locked (null if not locked). */
  lockedUntilIso: string | null;
  /** Whether an unlock attempt is currently in progress. */
  isUnlocking: boolean;
  /** Error message to display after a failed attempt. */
  error: string | null;
  /** Callback when the user submits a password to unlock. */
  onUnlock: (password: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Lock screen shown when personal notes have a password set and
 * the session has not yet been unlocked.
 *
 * States:
 * - Normal: password input + "Desbloquear" button.
 * - Locked out: countdown display "Bloqueado por X minutos".
 * - Failed attempt: "Senha incorreta. Tentativas restantes: N".
 */
export function PersonalNotesLock({
  lockedUntilIso,
  isUnlocking,
  error,
  onUnlock,
}: PersonalNotesLockProps) {
  const [password, setPassword] = useState('');

  // A monotonically incrementing tick that forces re-computation of the
  // countdown text every second. Avoids calling setState synchronously
  // inside an effect (which the React Compiler flags as cascading renders).
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!lockedUntilIso) return;

    const id = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 1_000);

    return () => clearInterval(id);
  }, [lockedUntilIso]);

  // Derived on every render from the prop + current time (triggered by tick).
  // `tick` is read here to ensure React re-renders when the interval fires.
  void tick;
  const countdownText = computeCountdown(lockedUntilIso);
  const isLockedOut = !!countdownText;

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!password.trim() || isLockedOut || isUnlocking) return;
      onUnlock(password);
      setPassword('');
    },
    [password, isLockedOut, isUnlocking, onUnlock],
  );

  return (
    <div className="flex items-center justify-center py-16" data-testid="personal-notes-lock">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-4 pt-6">
          <Lock className="text-text-tertiary h-10 w-10" aria-hidden="true" />
          <h4 className="text-text-primary text-lg font-semibold">Notas protegidas</h4>

          {isLockedOut ? (
            <p
              className="text-danger-700 text-center text-sm"
              data-testid="personal-notes-lockout-message"
            >
              {countdownText}
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
              <Input
                type="password"
                placeholder="Senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isUnlocking}
                aria-label="Senha das notas pessoais"
                data-testid="personal-notes-lock-password"
              />

              {error && (
                <p
                  className="text-danger-700 text-center text-sm"
                  data-testid="personal-notes-lock-error"
                >
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={!password.trim() || isUnlocking}
                data-testid="personal-notes-lock-submit"
              >
                {isUnlocking ? 'Desbloqueando...' : 'Desbloquear'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
