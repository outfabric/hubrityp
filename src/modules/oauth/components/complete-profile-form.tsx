'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { type z } from 'zod';

import { UFS } from '@/modules/registration/lib/uf-table';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

import {
  completeProfileInputSchema,
  type CompleteProfileInput,
} from '../lib/complete-profile-input-schema';

// Result shape matching `CompleteOAuthProfileResult`.
export type CompleteProfileResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'duplicate_crp' | 'invalid_session' | 'unknown' };

export type CompleteProfileFormProps = {
  /** Pre-filled email from the OAuth provider (read-only). */
  email: string;
  /** Pre-filled full name from `user.user_metadata.full_name`. */
  defaultFullName?: string;
  /** Server Action to submit the form. */
  action: (formData: FormData) => Promise<CompleteProfileResult>;
};

type FormValues = z.input<typeof completeProfileInputSchema>;

const FALLBACK_ERROR_COPY = 'Ocorreu um erro. Tente novamente.';
const TOP_LEVEL_ERROR_COPY: Record<string, string> = {
  duplicate_crp: 'Este CRP já está cadastrado.',
  invalid_session: 'Sessão expirada. Tente novamente.',
  unknown: FALLBACK_ERROR_COPY,
};

export function CompleteProfileForm({ email, defaultFullName, action }: CompleteProfileFormProps) {
  const [isPending, startTransition] = useTransition();
  const [topLevelError, setTopLevelError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<FormValues, unknown, CompleteProfileInput>({
    resolver: zodResolver(completeProfileInputSchema),
    mode: 'onTouched',
    defaultValues: {
      fullName: defaultFullName ?? '',
      crpNumber: '',
      crpUf: '',
      acceptedTerms: false as true,
      acceptedPrivacy: false as true,
      acceptedSensitiveData: false as true,
    },
  });

  const crpUfRegister = register('crpUf');

  const ids = {
    fullName: useId(),
    crpNumber: useId(),
    crpUf: useId(),
    terms: useId(),
    privacy: useId(),
    sensitive: useId(),
  } as const;

  const onSubmit = handleSubmit((values) => {
    setTopLevelError(null);

    const formData = new FormData();
    formData.set('fullName', String(values.fullName));
    formData.set('crpNumber', String(values.crpNumber));
    formData.set('crpUf', String(values.crpUf));
    if (values.acceptedTerms) formData.set('acceptedTerms', 'on');
    if (values.acceptedPrivacy) formData.set('acceptedPrivacy', 'on');
    if (values.acceptedSensitiveData) formData.set('acceptedSensitiveData', 'on');

    startTransition(async () => {
      const result = await action(formData);

      if (result.ok) {
        setTopLevelError(null);
        return;
      }

      if (result.error === 'invalid_input') {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (messages.length > 0) {
            setError(field as keyof FormValues, {
              type: 'server',
              message: messages[0],
            });
          }
        }
        setTopLevelError(null);
        return;
      }

      setTopLevelError(TOP_LEVEL_ERROR_COPY[result.error] ?? FALLBACK_ERROR_COPY);
    });
  });

  return (
    <form
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="space-y-5"
      noValidate
    >
      {/* Email (read-only from OAuth provider) */}
      <div className="space-y-2">
        <Label>E-mail</Label>
        <Input type="email" value={email} readOnly disabled className="bg-muted" />
      </div>

      {/* Nome completo */}
      <div className="space-y-2">
        <Label htmlFor={ids.fullName}>Nome completo</Label>
        <Input
          id={ids.fullName}
          type="text"
          autoComplete="name"
          required
          aria-invalid={errors.fullName ? true : undefined}
          data-testid="complete-profile-form-name"
          {...register('fullName')}
        />
        {errors.fullName?.message ? (
          <p className="text-destructive text-sm">{errors.fullName.message}</p>
        ) : null}
      </div>

      {/* CRP */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_140px]">
        <div className="space-y-2">
          <Label htmlFor={ids.crpNumber}>Número do CRP</Label>
          <Input
            id={ids.crpNumber}
            type="text"
            inputMode="numeric"
            placeholder="06/123456"
            required
            aria-invalid={errors.crpNumber ? true : undefined}
            data-testid="complete-profile-form-crp-number"
            {...register('crpNumber')}
          />
          {errors.crpNumber?.message ? (
            <p className="text-destructive text-sm">{errors.crpNumber.message}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor={ids.crpUf}>UF</Label>
          <input type="hidden" {...crpUfRegister} />
          <Select
            onValueChange={(value) => {
              setValue('crpUf', value, {
                shouldValidate: true,
                shouldTouch: true,
                shouldDirty: true,
              });
            }}
          >
            <SelectTrigger
              id={ids.crpUf}
              aria-invalid={errors.crpUf ? true : undefined}
              data-testid="complete-profile-form-crp-uf"
            >
              <SelectValue placeholder="UF" />
            </SelectTrigger>
            <SelectContent>
              {UFS.map((uf) => (
                <SelectItem key={uf} value={uf}>
                  {uf}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.crpUf?.message ? (
            <p className="text-destructive text-sm">{errors.crpUf.message}</p>
          ) : null}
        </div>
      </div>

      {/* Consents */}
      <div className="space-y-3">
        <ConsentRow
          inputId={ids.terms}
          testId="complete-profile-form-terms"
          label="Aceito os Termos de Uso"
          register={register('acceptedTerms')}
          setValue={(checked) =>
            setValue('acceptedTerms', checked as true, {
              shouldValidate: true,
              shouldTouch: true,
              shouldDirty: true,
            })
          }
          errorMessage={errors.acceptedTerms?.message}
        />
        <ConsentRow
          inputId={ids.privacy}
          testId="complete-profile-form-privacy"
          label="Aceito a Política de Privacidade"
          register={register('acceptedPrivacy')}
          setValue={(checked) =>
            setValue('acceptedPrivacy', checked as true, {
              shouldValidate: true,
              shouldTouch: true,
              shouldDirty: true,
            })
          }
          errorMessage={errors.acceptedPrivacy?.message}
        />
        <ConsentRow
          inputId={ids.sensitive}
          testId="complete-profile-form-sensitive-data"
          label="Aceito o Tratamento de Dados Sensíveis (LGPD)"
          register={register('acceptedSensitiveData')}
          setValue={(checked) =>
            setValue('acceptedSensitiveData', checked as true, {
              shouldValidate: true,
              shouldTouch: true,
              shouldDirty: true,
            })
          }
          errorMessage={errors.acceptedSensitiveData?.message}
        />
      </div>

      {/* Top-level error */}
      {topLevelError ? (
        <p
          role="alert"
          aria-live="polite"
          data-testid="complete-profile-form-error"
          className="text-destructive text-sm"
        >
          {topLevelError}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={isPending}
        data-testid="complete-profile-form-submit"
        className="w-full"
      >
        {isPending ? 'Salvando...' : 'Completar cadastro'}
      </Button>
    </form>
  );
}

type RegisterReturn = ReturnType<ReturnType<typeof useForm<FormValues>>['register']>;

function ConsentRow({
  inputId,
  testId,
  label,
  register,
  setValue,
  errorMessage,
}: {
  inputId: string;
  testId: string;
  label: string;
  register: RegisterReturn;
  setValue: (checked: boolean) => void;
  errorMessage: string | undefined;
}) {
  return (
    <div>
      <div className="flex items-start gap-3">
        <Checkbox
          id={inputId}
          data-testid={testId}
          aria-invalid={errorMessage ? true : undefined}
          onCheckedChange={(checked) => setValue(checked === true)}
        />
        <input type="hidden" {...register} />
        <Label htmlFor={inputId} className="cursor-pointer text-sm leading-snug">
          {label}
        </Label>
      </div>
      {errorMessage ? <p className="text-destructive mt-1 ml-7 text-sm">{errorMessage}</p> : null}
    </div>
  );
}
