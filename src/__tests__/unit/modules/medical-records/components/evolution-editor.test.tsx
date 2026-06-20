import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EvolutionEditor } from '@/modules/medical-records/components/evolution-editor';

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

// The `livre` template renders a single rich-text field ("Conteúdo"), the
// simplest surface to exercise the dirty/save cycle.
function renderEditor(onSave: (content: Record<string, unknown>) => Promise<void>) {
  return render(
    <EvolutionEditor templateType="livre" initialContent={{ conteudo: '' }} onSave={onSave} />,
  );
}

describe('EvolutionEditor — manual save button', () => {
  it('disables the save button on a clean mount', () => {
    renderEditor(vi.fn().mockResolvedValue(undefined));

    expect(screen.getByTestId('evolution-save-button')).toBeDisabled();
  });

  it('enables the save button after editing content', async () => {
    const user = userEvent.setup();
    renderEditor(vi.fn().mockResolvedValue(undefined));

    await user.type(screen.getByLabelText('Conteúdo'), 'nova evolução');

    expect(screen.getByTestId('evolution-save-button')).toBeEnabled();
  });

  it('calls the save handler when the button is clicked', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderEditor(onSave);

    await user.type(screen.getByLabelText('Conteúdo'), 'conteúdo manual');
    await user.click(screen.getByTestId('evolution-save-button'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ conteudo: 'conteúdo manual' }));
  });

  it('disables the button again after a successful save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderEditor(onSave);

    await user.type(screen.getByLabelText('Conteúdo'), 'texto');
    expect(screen.getByTestId('evolution-save-button')).toBeEnabled();

    await user.click(screen.getByTestId('evolution-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('evolution-save-button')).toBeDisabled();
    });
  });
});
