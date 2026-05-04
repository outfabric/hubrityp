'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/shared/lib/utils';

/**
 * Label — Sálvia design system primitive.
 *
 * Wraps Radix's `LabelPrimitive` to inherit its accessibility behavior
 * (clicking the label focuses the associated control). Visual treatment
 * mirrors `docs/design-system/rules.md`: 14px (Tailwind `text-sm`), weight
 * 500, color `text-primary`. Disabled-peer styling is preserved so a
 * disabled input greys its label automatically when wired via
 * `<Input className="peer" />`.
 */
const labelVariants = cva(
  'text-sm font-medium leading-none text-text-primary peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
);

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props} />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
