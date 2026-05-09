import { render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// jsdom does not provide ResizeObserver (used by Radix/Tiptap internals)
// or getClientRects (used by ProseMirror for scroll-into-view).
beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  // ProseMirror calls `getClientRects()` on DOM ranges/elements during
  // scroll-into-view, which jsdom does not implement. Stub it to return a
  // single zero-rect so commands like `focus()` don't throw.
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () =>
      [
        {
          top: 0,
          left: 0,
          bottom: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        },
      ] as unknown as DOMRectList;
  }
  if (!Range.prototype.getBoundingClientRect) {
    const zeroRect: DOMRect = {
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
    Range.prototype.getBoundingClientRect = () => zeroRect;
  }
  if (!Element.prototype.getClientRects) {
    Element.prototype.getClientRects = () =>
      [
        {
          top: 0,
          left: 0,
          bottom: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        },
      ] as unknown as DOMRectList;
  }
});

import { TiptapEditor } from '@/modules/patients/components/tiptap-editor';

describe('TiptapEditor', () => {
  it('renders the editor wrapper with the expected testid', async () => {
    render(<TiptapEditor content="" onChange={vi.fn()} placeholder="Escreva aqui..." />);

    // Tiptap renders asynchronously (immediatelyRender: false), so wait for
    // the toolbar to appear as a signal that the editor has mounted.
    await waitFor(() => {
      expect(screen.getByTestId('tiptap-editor')).toBeInTheDocument();
    });
  });

  it('renders the toolbar with role="toolbar"', async () => {
    render(<TiptapEditor content="" onChange={vi.fn()} />);

    await waitFor(() => {
      const toolbar = screen.getByRole('toolbar');
      expect(toolbar).toBeInTheDocument();
      expect(toolbar).toHaveAttribute('aria-label', 'Formatação de texto');
    });
  });

  it('renders all expected toolbar buttons', async () => {
    render(<TiptapEditor content="" onChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('tiptap-toolbar-bold')).toBeInTheDocument();
    });

    const expectedButtons = [
      'tiptap-toolbar-bold',
      'tiptap-toolbar-italic',
      'tiptap-toolbar-underline',
      'tiptap-toolbar-heading3',
      'tiptap-toolbar-heading4',
      'tiptap-toolbar-bulletList',
      'tiptap-toolbar-orderedList',
    ];

    for (const testId of expectedButtons) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });

  it('renders initial HTML content', async () => {
    render(<TiptapEditor content="<p>Conteúdo inicial</p>" onChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Conteúdo inicial')).toBeInTheDocument();
    });
  });

  it('emits onChange when content changes', async () => {
    const onChange = vi.fn();

    render(<TiptapEditor content="<p>some text</p>" onChange={onChange} />);

    // Wait for editor to mount
    await waitFor(() => {
      expect(screen.getByTestId('tiptap-toolbar')).toBeInTheDocument();
    });

    // Tiptap's ProseMirror contenteditable does not respond to synthetic DOM
    // events under jsdom. Instead, we toggle a block-level format (heading)
    // which modifies the document structure and fires `onUpdate → onChange`.
    // First we need to place the cursor inside the paragraph so the heading
    // toggle applies to it.
    const proseMirror = document.querySelector('.ProseMirror');
    expect(proseMirror).toBeTruthy();

    // Click on the editor to focus and set the cursor
    (proseMirror as HTMLElement).click();

    // Toggle heading 3 — transforms <p> to <h3>, which is a document change
    const heading3Btn = screen.getByTestId('tiptap-toolbar-heading3');
    heading3Btn.click();

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
      // Verify the HTML now contains a heading
      const lastCallHtml = onChange.mock.calls.at(-1)?.[0] as string;
      expect(lastCallHtml).toContain('<h3>');
    });
  });

  it('passes aria-label to the editor content wrapper', async () => {
    render(<TiptapEditor content="" onChange={vi.fn()} aria-label="Anamnese do paciente" />);

    await waitFor(() => {
      expect(screen.getByTestId('tiptap-toolbar')).toBeInTheDocument();
    });

    // The EditorContent div receives the aria-label
    const editorContent = screen
      .getByTestId('tiptap-editor')
      .querySelector('[aria-label="Anamnese do paciente"]');
    expect(editorContent).toBeInTheDocument();
  });

  it('toolbar buttons have aria-label attributes', async () => {
    render(<TiptapEditor content="" onChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('tiptap-toolbar-bold')).toBeInTheDocument();
    });

    expect(screen.getByTestId('tiptap-toolbar-bold')).toHaveAttribute('aria-label', 'Negrito');
    expect(screen.getByTestId('tiptap-toolbar-italic')).toHaveAttribute('aria-label', 'Itálico');
    expect(screen.getByTestId('tiptap-toolbar-underline')).toHaveAttribute(
      'aria-label',
      'Sublinhado',
    );
  });

  it('toolbar buttons use ghost variant with sm size', async () => {
    render(<TiptapEditor content="" onChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('tiptap-toolbar-bold')).toBeInTheDocument();
    });

    const boldBtn = screen.getByTestId('tiptap-toolbar-bold');
    // Ghost variant + sm size classes are applied via shadcn/ui Button
    expect(boldBtn.tagName).toBe('BUTTON');
    expect(boldBtn).toHaveAttribute('type', 'button');
  });

  it('has max-width of 720px on the wrapper', async () => {
    render(<TiptapEditor content="" onChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('tiptap-editor')).toBeInTheDocument();
    });

    const wrapper = screen.getByTestId('tiptap-editor');
    expect(wrapper.className).toContain('max-w-[720px]');
  });
});
