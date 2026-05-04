import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/shared/lib/utils';

/**
 * Alert — Sálvia design system primitive.
 *
 * Inline feedback block for non-blocking, contextual messages (e.g., "form
 * saved", "session limit reached"). Tone is communicated through the bordered
 * tinted surface; titles use weight 500, descriptions inherit body color.
 *
 * Variants follow the semantic palette in `docs/design-system/rules.md`:
 * `default` (neutral), `success`, `warning`, `danger`, `info`. Each variant
 * pairs a `*-50` background with a `*-700` foreground for AA contrast.
 *
 * Slot icon: an SVG passed as the first child renders in the small left
 * column thanks to the `[&>svg]:*` selectors. We do not lock the icon
 * choice into the primitive — the design-system mapping (rules.md
 * §Iconografia) belongs at the call site.
 */
const alertVariants = cva(
  'relative w-full rounded-lg border p-4 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-current [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        default: 'bg-surface border-border text-text-primary',
        success: 'bg-success-50 border-success-500 text-success-700',
        warning: 'bg-warning-50 border-warning-500 text-warning-700',
        danger: 'bg-danger-50 border-danger-500 text-danger-700',
        info: 'bg-info-50 border-info-500 text-info-700',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
  ),
);
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5
      ref={ref}
      className={cn('mb-1 leading-none font-medium tracking-tight', className)}
      {...props}
    />
  ),
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
