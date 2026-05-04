import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/shared/lib/utils';

/**
 * Button — Sálvia design system primitive.
 *
 * Variants and sizes mirror `docs/design-system/rules.md` §Componentes.Button.
 * All colors, radii, and durations are token-backed (`bg-brand-*`,
 * `text-text-*`, `rounded-lg`, `duration-fast`); literal hex/rgb values are
 * forbidden. The exported props contract (`ButtonProps`, `asChild`,
 * `displayName === 'Button'`) is preserved for backward compatibility with
 * existing call sites such as `app/(auth)/login/login-form.tsx`.
 */
const buttonVariants = cva(
  // Base — typography, layout, focus ring, disabled state, icon sizing.
  // The focus ring is supplied globally by `globals.css`, but we also keep
  // a `focus-visible:shadow-focus` utility here so consumers that override
  // the global ring still get the brand ring on the button itself.
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Primary — single ação principal por contexto (rules.md).
        default: 'bg-brand-500 text-text-inverse hover:bg-brand-600 active:bg-brand-700',
        // Destrutivo — exclusões e cancelamentos irreversíveis.
        destructive: 'bg-danger-500 text-text-inverse hover:bg-danger-700 active:bg-danger-700',
        // Outline — alternativa ao secondary, sem fill.
        outline: 'border border-border-strong bg-surface text-text-primary hover:bg-surface-muted',
        // Secondary — ações secundárias.
        secondary:
          'bg-surface border border-border-strong text-text-primary hover:bg-surface-muted',
        // Ghost — toolbars, ações terciárias.
        ghost: 'text-text-primary hover:bg-surface-muted',
        // Link — navegação textual; underline aparece somente no hover.
        link: 'text-brand-700 underline-offset-4 hover:underline',
      },
      size: {
        // md (default) — 40px h, 15px font (rules.md tabela de Buttons).
        default: 'h-10 px-4 py-2',
        // sm — 32px h, 13px font.
        sm: 'h-8 rounded-md px-3 text-xs',
        // lg — 48px h, 16px font.
        lg: 'h-12 rounded-lg px-8 text-base',
        // Square button (icon-only) — kept at md height for consistent rows.
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
