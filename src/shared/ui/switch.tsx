'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as React from 'react';

import { cn } from '@/shared/lib/utils';

/**
 * Switch -- Salvia design system primitive.
 *
 * Wraps Radix's `SwitchPrimitive` with Salvia visual tokens:
 * - Off: bg `surface-muted`, border `border-strong`
 * - On: bg `brand-500`
 * - Thumb: bg `surface` (white), shadow-sm
 * - Focus: `shadow-focus` ring
 * - Disabled: 50% opacity
 */
const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    className={cn(
      'peer duration-fast inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors',
      'focus-visible:shadow-focus focus-visible:outline-none',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-brand-500 data-[state=unchecked]:bg-surface-muted',
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'bg-surface duration-fast pointer-events-none block h-4 w-4 rounded-full shadow-sm ring-0 transition-transform',
        'data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

export { Switch };
