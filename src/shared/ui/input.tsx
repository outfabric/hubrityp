import * as React from 'react';

import { cn } from '@/shared/lib/utils';

/**
 * Input — Sálvia design system primitive.
 *
 * Idle: border `border`, bg `surface-sunken` (rules.md §Componentes.Input).
 * Focus: border `brand-500`, bg `surface`, ring via global `:focus-visible`
 * (declared in `globals.css`). Error styling is opt-in via `aria-invalid`,
 * matching the WAI-ARIA pattern that consumers like `LoginForm` already use.
 *
 * Public API preserved: forwards every native `<input>` prop plus a
 * `ref` to the underlying element. `displayName === 'Input'`.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'border-border bg-surface-sunken text-text-primary duration-fast placeholder:text-text-tertiary flex h-10 w-full rounded-md border px-3 py-2 text-sm transition-colors',
          'file:text-text-primary file:border-0 file:bg-transparent file:text-sm file:font-medium',
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
Input.displayName = 'Input';

export { Input };
