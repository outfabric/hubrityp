import * as React from 'react';

import { cn } from '@/shared/lib/utils';

/**
 * SkipLink — "Pular para o conteúdo" bypass link.
 *
 * Accessibility requirement (WCAG 2.4.1, Bypass Blocks): the first focusable
 * element on every public page lets keyboard / screen-reader users jump past
 * the header straight to the main content. It targets `#conteudo`, the id on
 * the public layout's single `<main>`.
 *
 * Visually hidden until focused: `sr-only` removes it from the visual flow,
 * and `focus:not-sr-only` brings it back on keyboard focus, pinned to the
 * top-left with a brand-tinted surface so it is clearly visible.
 *
 * Presentational only — renders a plain anchor, no client hooks.
 */

/** The id of the `<main>` landmark this link jumps to. */
export const MAIN_CONTENT_ID = 'conteudo';

export interface SkipLinkProps {
  className?: string;
}

export function SkipLink({ className }: SkipLinkProps): React.JSX.Element {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className={cn(
        'sr-only',
        'focus:bg-surface focus:text-text-primary focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md',
        className,
      )}
    >
      Pular para o conteúdo
    </a>
  );
}

SkipLink.displayName = 'SkipLink';
