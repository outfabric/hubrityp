import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PhoneInput } from '@/modules/patients/components/phone-input';

afterEach(cleanup);

/**
 * Controlled wrapper so the test exercises the real external contract:
 * `value` in canonical form, `onChange` emitting canonical (or `''`).
 */
function ControlledPhoneInput({
  initial = '',
  onChangeSpy,
  ...props
}: {
  initial?: string;
  onChangeSpy?: (v: string) => void;
} & Partial<React.ComponentProps<typeof PhoneInput>>) {
  const [value, setValue] = React.useState(initial);
  return (
    <PhoneInput
      data-testid="phone-input"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChangeSpy?.(v);
      }}
      {...props}
    />
  );
}

describe('PhoneInput', () => {
  it('forwards data-testid to the inner <input> and sets tel/numeric attributes', () => {
    render(<ControlledPhoneInput />);
    const input = screen.getByTestId('phone-input');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('type', 'tel');
    expect(input).toHaveAttribute('inputmode', 'numeric');
  });

  it('emits canonical onChange values as the user types digits', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    render(<ControlledPhoneInput onChangeSpy={onChangeSpy} />);

    const input = screen.getByTestId('phone-input');
    await user.type(input, '11912345678');

    // Final emitted value is canonical.
    expect(onChangeSpy).toHaveBeenLastCalledWith('+55 11 91234-5678');
    // Editable text never carries the +55 country code.
    expect(input).toHaveValue('11 91234-5678');
  });

  it('does not include +55 in the editable value', async () => {
    const user = userEvent.setup();
    render(<ControlledPhoneInput />);
    const input = screen.getByTestId('phone-input');
    await user.type(input, '21998765432');
    expect(input).toHaveValue('21 99876-5432');
    expect((input as HTMLInputElement).value).not.toContain('+55');
  });

  it('emits empty string when the input is cleared', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    render(<ControlledPhoneInput initial="+55 11 91234-5678" onChangeSpy={onChangeSpy} />);

    const input = screen.getByTestId('phone-input');
    await user.clear(input);

    expect(onChangeSpy).toHaveBeenLastCalledWith('');
    expect(input).toHaveValue('');
  });

  it('prefills a canonical value as the national display', () => {
    render(<ControlledPhoneInput initial="+55 11 91234-5678" />);
    const input = screen.getByTestId('phone-input');
    expect(input).toHaveValue('11 91234-5678');
  });

  it('renders the non-editable +55 adornment as aria-hidden', () => {
    render(<ControlledPhoneInput />);
    const adornment = screen.getByText('+55');
    expect(adornment).toHaveAttribute('aria-hidden', 'true');
  });

  it('forwards id, aria-invalid, placeholder and disabled to the inner <input>', () => {
    render(
      <ControlledPhoneInput id="patient-phone" aria-invalid placeholder="11 91234-5678" disabled />,
    );
    const input = screen.getByTestId('phone-input');
    expect(input).toHaveAttribute('id', 'patient-phone');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('placeholder', '11 91234-5678');
    expect(input).toBeDisabled();
  });
});
