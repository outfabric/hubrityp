'use client';

import * as React from 'react';

import { cn } from '@/shared/lib/utils';

import { maskNationalPhone, toCanonical, toNationalDisplay } from '../lib/patient-validators';

/**
 * PhoneInput — Sálvia design system phone field for Brazilian mobile numbers.
 *
 * Speaks two formats:
 *   - **Externally** (the `value`/`onChange` contract): the canonical stored
 *     format `+55 DD NNNNN-NNNN`, or `''` when the field is empty. This keeps
 *     the component a near drop-in replacement for a plain `Input` bound to a
 *     canonical form field — `isValidBrazilianPhone`, Zod schemas, submit
 *     payloads, prefill, and `wa.me` links all stay canonical and untouched.
 *   - **Internally** (the editable text the user sees and types): only the
 *     national portion `DD NNNNN-NNNN`. The `+55` country code is rendered as a
 *     non-editable, `aria-hidden` adornment to the left of the input, so it is
 *     never part of the editable value and never re-fed as data.
 *
 * The wrapper is styled as a single field (mirroring `Input` from the design
 * system) and carries the focus ring; the inner `<input>` itself is borderless.
 *
 * Controlled only: `value` is the source of truth. We keep a small internal
 * national-text state so the user can type intermediate values (e.g. a partial
 * DDD) without the canonical round-trip eating their keystrokes, but we always
 * reconcile to the controlled `value` when it changes from the outside (prefill,
 * form reset).
 */

type PhoneInputProps = {
  /** Canonical value `+55 DD NNNNN-NNNN`, or `''` when empty. */
  value: string;
  /** Emits the canonical value (or `''` when the national part is empty). */
  onChange: (value: string) => void;
} & Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'inputMode'>;

const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ value, onChange, className, disabled, ...props }, ref) => {
    // Editable national text shown to the user. Derived from the canonical
    // `value` on mount and reconciled whenever `value` changes externally.
    const [national, setNational] = React.useState<string>(() => toNationalDisplay(value));

    // Reconcile internal national text when the canonical value is driven from
    // the outside (prefill / reset). We compare by canonical form so that a
    // keystroke that produced the same canonical value does not clobber the
    // user's in-progress text (e.g. a trailing space).
    React.useEffect(() => {
      if (toCanonical(national) !== value) {
        setNational(toNationalDisplay(value));
      }
      // We intentionally depend only on `value`: this effect's job is to react
      // to external changes, not to re-run on every local keystroke.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const masked = maskNationalPhone(event.target.value);
      setNational(masked);
      onChange(toCanonical(masked));
    };

    return (
      <div
        className={cn(
          'border-border bg-surface-sunken text-text-primary duration-fast flex h-10 w-full items-center rounded-md border px-3 text-sm transition-colors',
          'focus-within:bg-surface focus-within:border-brand-500 focus-within:shadow-focus',
          'has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50',
          'has-[input[aria-invalid=true]]:border-danger-500',
          className,
        )}
      >
        <span aria-hidden="true" className="text-text-tertiary pr-2 select-none">
          +55
        </span>
        <input
          {...props}
          ref={ref}
          type="tel"
          inputMode="numeric"
          disabled={disabled}
          value={national}
          onChange={handleChange}
          className={cn(
            'text-text-primary placeholder:text-text-tertiary h-full w-full border-0 bg-transparent p-0 outline-none',
            'disabled:cursor-not-allowed',
          )}
        />
      </div>
    );
  },
);
PhoneInput.displayName = 'PhoneInput';

export { PhoneInput };
export type { PhoneInputProps };
