'use client';

// ScreenshotLightbox — accessible single-image modal for the funcionalidades grid.
// --------------------------------------------------------------------------
// A leaf Client Component that renders a full-size screenshot in a modal dialog.
// It is intentionally NOT a gallery: each feature card opens exactly one image,
// so there is no prev/next navigation — only view and dismiss.
//
// Accessibility contract (WAI-ARIA "modal dialog" pattern):
//   - role="dialog" + aria-modal="true" + aria-label (the screenshot alt text);
//   - dismissible via the Escape key AND a visible close button;
//   - focus trap: Tab / Shift+Tab cycle ONLY between the focusable elements
//     inside the dialog (here, just the close button), so focus can never leak
//     to the page behind the overlay;
//   - focus restore: on open, focus moves into the dialog; on close, focus
//     returns to the element that opened it (the trigger), satisfying the
//     "restore focus to invoker" rule.
//   - clicking the backdrop also dismisses.
//
// This is a presentational leaf: it carries no PII and no secrets — only the
// static screenshot asset (src/alt/dims) the parent passes in. The image is
// served from `public/` so there is no user-controlled URL sink.

import { X } from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

import { cn } from '@/shared/lib/utils';

/** The screenshot rendered inside the lightbox. */
export interface LightboxScreenshot {
  /** Image source (a `public/`-served WebP path). */
  readonly src: string;
  /** Descriptive pt-BR alt text — also used as the dialog's accessible name. */
  readonly alt: string;
  /** Intrinsic width in px (reserves the box so the modal does not jump). */
  readonly width: number;
  /** Intrinsic height in px. */
  readonly height: number;
}

export interface ScreenshotLightboxProps {
  /** Whether the modal is open. When `false`, nothing is rendered. */
  readonly open: boolean;
  /** Called when the user dismisses (Escape, close button, or backdrop click). */
  readonly onClose: () => void;
  /** The single screenshot to display. */
  readonly screenshot: LightboxScreenshot;
}

/**
 * Accessible single-image lightbox. Renders only when `open` is `true`. Traps
 * focus, closes on Escape / close button / backdrop, and restores focus to the
 * triggering element on close.
 */
export function ScreenshotLightbox({
  open,
  onClose,
  screenshot,
}: ScreenshotLightboxProps): React.JSX.Element | null {
  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  // Remember the element that had focus when the modal opened so we can restore
  // focus to it on close (WAI-ARIA "return focus to the invoker" requirement).
  const previouslyFocusedRef = React.useRef<HTMLElement | null>(null);

  // Capture the invoker and move focus into the dialog when it opens; restore
  // focus to the invoker when it closes (or unmounts while open).
  React.useEffect(() => {
    if (!open) {
      return;
    }

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Move focus to the close button so the very first Tab stays trapped and a
    // screen reader lands inside the dialog immediately.
    closeButtonRef.current?.focus();

    return () => {
      previouslyFocusedRef.current?.focus();
    };
  }, [open]);

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      // Focus trap: the close button is the only focusable control, so any Tab
      // (forward or backward) must keep focus on it and never escape the dialog.
      event.preventDefault();
      closeButtonRef.current?.focus();
    },
    [onClose],
  );

  if (!open) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={screenshot.alt}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8"
    >
      {/* Backdrop: dimmed, dismisses on click. Decorative (not in the a11y tree);
          the dialog's own controls provide the accessible dismiss path. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />

      {/* Dialog surface. Stops propagation so a click on the image/frame does not
          bubble to the backdrop and close the modal. */}
      <div
        className={cn(
          'bg-surface relative z-10 flex max-h-full max-w-5xl flex-col overflow-hidden rounded-xl shadow-lg',
        )}
      >
        <div className="border-border-subtle flex items-center justify-end border-b px-3 py-2">
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className={cn(
              'border-border-subtle bg-surface text-text-primary inline-flex size-10 items-center justify-center rounded-full border shadow-xs',
              'focus-visible:shadow-focus outline-none',
              'hover:bg-surface-muted transition-colors',
            )}
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <div className="overflow-auto">
          <Image
            src={screenshot.src}
            alt={screenshot.alt}
            width={screenshot.width}
            height={screenshot.height}
            sizes="(max-width: 1024px) 100vw, 960px"
            className="h-auto w-full"
          />
        </div>
      </div>
    </div>
  );
}

ScreenshotLightbox.displayName = 'ScreenshotLightbox';
