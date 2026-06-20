import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PersonalNotesTab } from '@/modules/medical-records/components/personal-notes-tab';

// ---------------------------------------------------------------------------
// Mock TiptapEditor — the real editor pulls ProseMirror, which needs DOM APIs
// (ResizeObserver, getClientRects) jsdom lacks. The manual-save behaviour under
// test depends only on content changing through onChange, so a plain textarea
// faithfully drives the same path while keeping the test focused.
// ---------------------------------------------------------------------------
vi.mock('@/modules/patients/components/tiptap-editor', () => ({
  TiptapEditor: ({
    content,
    onChange,
    'aria-label': ariaLabel,
  }: {
    content: string;
    onChange: (html: string) => void;
    'aria-label'?: string;
  }) => (
    <textarea aria-label={ariaLabel} value={content} onChange={(e) => onChange(e.target.value)} />
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';

interface RenderOptions {
  /** Whether the notes are password-protected (drives the locked state). */
  hasPassword?: boolean;
  upsertPersonalNotes?: ReturnType<typeof vi.fn>;
}

function renderTab({ hasPassword = false, upsertPersonalNotes }: RenderOptions = {}) {
  const upsert = upsertPersonalNotes ?? vi.fn().mockResolvedValue({ ok: true });

  // Metadata-only fetch on mount. When there is no password, the server returns
  // content immediately and the editor renders unlocked. When a password is
  // set, only metadata comes back and the lock screen is shown.
  const getPersonalNotes = vi
    .fn()
    .mockResolvedValue(
      hasPassword
        ? { ok: true, hasPassword: true, isLocked: false, lockedUntilIso: null }
        : { ok: true, hasPassword: false, isLocked: false, lockedUntilIso: null, content: '' },
    );

  const utils = render(
    <PersonalNotesTab
      patientId={PATIENT_ID}
      getPersonalNotes={getPersonalNotes}
      upsertPersonalNotes={upsert}
      setPersonalNotesPassword={vi.fn().mockResolvedValue({ ok: true })}
      removePersonalNotesPassword={vi.fn().mockResolvedValue({ ok: true })}
    />,
  );

  return { ...utils, upsert };
}

describe('PersonalNotesTab — manual save button', () => {
  it('disables the save button on a clean unlocked mount', async () => {
    renderTab();

    // The editor renders only after the metadata fetch resolves.
    const button = await screen.findByTestId('personal-notes-save-button');
    expect(button).toBeDisabled();
  });

  it('enables the save button after editing the notes', async () => {
    const user = userEvent.setup();
    renderTab();

    await screen.findByTestId('personal-notes-save-button');
    await user.type(screen.getByLabelText('Notas pessoais'), 'nota nova');

    expect(screen.getByTestId('personal-notes-save-button')).toBeEnabled();
  });

  it('calls upsertPersonalNotes when the save button is clicked', async () => {
    const user = userEvent.setup();
    const { upsert } = renderTab();

    await screen.findByTestId('personal-notes-save-button');
    await user.type(screen.getByLabelText('Notas pessoais'), 'conteúdo manual');
    await user.click(screen.getByTestId('personal-notes-save-button'));

    await waitFor(() => {
      expect(upsert).toHaveBeenCalledTimes(1);
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: PATIENT_ID, content: 'conteúdo manual' }),
    );
  });

  it('does not render the save button while the notes are locked', async () => {
    renderTab({ hasPassword: true });

    // The lock screen is shown; no editor and no save button.
    await screen.findByTestId('personal-notes-banner');
    expect(screen.queryByTestId('personal-notes-save-button')).not.toBeInTheDocument();
  });
});
