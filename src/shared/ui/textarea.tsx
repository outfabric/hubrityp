import * as React from 'react';

import { cn } from '@/shared/lib/utils';

/**
 * Textarea -- Salvia design system primitive.
 *
 * Same visual treatment as Input: idle border `border`, bg `surface-sunken`,
 * focus border `brand-500`, error via `aria-invalid`. Minimum height 80px.
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'border-border bg-surface-sunken text-text-primary duration-fast placeholder:text-text-tertiary flex min-h-[80px] w-full rounded-md border px-3 py-2 text-sm transition-colors',
          'focus:bg-surface focus:border-brand-500 focus-visible:shadow-focus focus:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'aria-[invalid=true]:border-danger-500 aria-[invalid=true]:focus-visible:shadow-focus',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
