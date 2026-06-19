import * as React from 'react';

import { cn } from '@/shared/lib/utils';

/**
 * Container — the shared horizontal-rhythm wrapper for the public site.
 *
 * Centers its children and caps the content width per the design-system
 * content-width convention:
 *   - `default` (general layout)  -> max 1200px
 *   - `reading` (prose / legal)   -> max 720px
 *
 * Horizontal padding follows the DS spacing tokens: `space/4` (16px) on
 * mobile, `space/8` (32px) from the `md` breakpoint up. Tailwind's `px-4` and
 * `md:px-8` resolve to those tokens (see `globals.css` spacing scale).
 *
 * Presentational only — no client hooks, safe to render in a Server Component.
 */
type ContainerWidth = 'default' | 'reading';

const WIDTH_CLASS: Record<ContainerWidth, string> = {
  default: 'max-w-[1200px]',
  reading: 'max-w-[720px]',
};

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Content-width variant. `reading` narrows to a comfortable prose measure. */
  width?: ContainerWidth;
}

export function Container({
  width = 'default',
  className,
  children,
  ...rest
}: ContainerProps): React.JSX.Element {
  return (
    <div className={cn('mx-auto w-full px-4 md:px-8', WIDTH_CLASS[width], className)} {...rest}>
      {children}
    </div>
  );
}

Container.displayName = 'Container';

// Exported for unit tests and any consumer that needs the raw width-class map
// without rendering the component (e.g. composing a bespoke wrapper).
export const CONTAINER_WIDTH_CLASS = WIDTH_CLASS;
