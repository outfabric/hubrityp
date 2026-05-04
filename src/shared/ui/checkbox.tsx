'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/shared/lib/utils';

/**
 * Checkbox — Sálvia design system primitive.
 *
 * Wraps Radix's `CheckboxPrimitive` so the component is keyboard-accessible
 * out of the box (Space toggles, focus ring renders globally). Visual states:
 *
 * - idle:    border `border-strong`, surface `surface`
 * - checked: bg `brand-500`, check icon in `text-inverse` (rules.md:
 *   "indicador de estado 'ativo'" uses brand)
 * - focus:   `focus-visible:shadow-focus` (the global focus ring also fires)
 * - disabled: 50% opacity
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer border-border-strong bg-surface h-4 w-4 shrink-0 rounded-sm border',
      'duration-fast transition-colors',
      'focus-visible:shadow-focus focus-visible:outline-none',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-brand-500 data-[state=checked]:text-text-inverse data-[state=checked]:border-brand-500',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn('flex items-center justify-center text-current')}>
      <Check className="h-3.5 w-3.5" aria-hidden="true" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
