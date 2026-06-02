'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ImagePlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Textarea } from '@/shared/ui/textarea';

import { profileStepSchema, type ProfileStepInput } from '../lib/wizard';

// ---------------------------------------------------------------------------
// Action result shapes (mirror the module impls' sanitized results)
// ---------------------------------------------------------------------------

export type SaveProfileStepResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' | 'unknown' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> };

export type UploadPhotoActionResult =
  | { ok: true; objectKey: string }
  | { ok: false; message: string };

export interface StepProfileProps {
  /**
   * Persists the `profile` step server-side (authorized by `auth.uid()`). The
   * RHF-validated form values are passed through and re-validated on the server
   * (the display name lands in `profiles.full_name`). The client passes NO user
   * id — authorization is session-only on the server.
   */
  onSaveStep: (input: ProfileStepInput) => Promise<SaveProfileStepResult>;
  /**
   * Uploads the optional profile photo. The file is re-validated SERVER-side
   * (MIME/size/extension); this client validation is advisory only.
   */
  onUploadPhoto: (formData: FormData) => Promise<UploadPhotoActionResult>;
}

// Advisory client-side photo constraints — the server is authoritative.
const ACCEPTED_PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * Coerces an empty/whitespace-only text input to `undefined` so an untouched
 * optional field validates as "absent" rather than failing the schema's
 * format check on an empty string.
 */
function emptyToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Wizard step 1 — "Sobre você".
 *
 * Client leaf: RHF + Zod ({@link profileStepSchema}) with blur-time validation
 * (`mode: 'onTouched'`) and inline error styling per the Sálvia design system
 * (`aria-invalid` border + `text-danger-700` message under the field). The
 * collected fields are exactly those the persistence layer validates
 * (display name required; phone and a short bio optional) — the wizard does
 * not invent fields the server cannot store.
 *
 * The optional photo is uploaded through {@link onUploadPhoto} (server-validated,
 * UUID-named, owner-scoped). On submit it advances the wizard via
 * {@link onSaveStep}. Server field errors are mapped back onto the matching RHF
 * fields; transport/unknown failures surface a non-blocking toast.
 */
export function StepProfile({ onSaveStep, onUploadPhoto }: StepProfileProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isUploading, startUpload] = useTransition();
  const [photoName, setPhotoName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ids = {
    displayName: useId(),
    phone: useId(),
    bio: useId(),
    photo: useId(),
  } as const;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ProfileStepInput>({
    resolver: zodResolver(profileStepSchema),
    mode: 'onTouched',
    defaultValues: { displayName: '', phone: '', bio: '' },
  });

  function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setPhotoName(null);
      return;
    }

    // Advisory client checks — the server re-validates and is authoritative.
    if (!ACCEPTED_PHOTO_MIME.includes(file.type)) {
      toast.error('Formato não suportado. Use JPEG, PNG ou WebP.');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error('A foto deve ter no máximo 5MB.');
      event.target.value = '';
      return;
    }

    const formData = new FormData();
    formData.set('file', file);
    setPhotoName(file.name);

    startUpload(async () => {
      const result = await onUploadPhoto(formData);
      if (!result.ok) {
        setPhotoName(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        toast.error(result.message);
        return;
      }
      toast.success('Foto enviada.');
    });
  }

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await onSaveStep(values);

      if (result.ok) {
        // The server advanced `onboarding_step` to `location`; move the user
        // forward to step 2. The page guard allows this because the resume
        // point now equals `location`.
        router.push('/onboarding/setup/location');
        return;
      }

      if (result.error === 'invalid_input') {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (messages.length > 0) {
            setError(field as keyof ProfileStepInput, { type: 'server', message: messages[0] });
          }
        }
        return;
      }

      toast.error('Não foi possível salvar. Tente novamente.');
    });
  });

  return (
    <form
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="flex flex-col gap-5"
      noValidate
      data-testid="step-profile-form"
    >
      {/* Display name (required) */}
      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.displayName}>Como você quer ser chamado</Label>
        <Input
          id={ids.displayName}
          type="text"
          autoComplete="name"
          aria-invalid={errors.displayName ? true : undefined}
          aria-describedby={errors.displayName ? `${ids.displayName}-error` : undefined}
          data-testid="step-profile-display-name"
          {...register('displayName')}
        />
        {errors.displayName?.message ? (
          <p
            id={`${ids.displayName}-error`}
            role="alert"
            className="text-danger-700 text-sm"
            data-testid="step-profile-display-name-error"
          >
            {errors.displayName.message}
          </p>
        ) : null}
      </div>

      {/* Phone (optional) */}
      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.phone}>Telefone (opcional)</Label>
        <Input
          id={ids.phone}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(11) 98765-4321"
          aria-invalid={errors.phone ? true : undefined}
          aria-describedby={errors.phone ? `${ids.phone}-error` : undefined}
          data-testid="step-profile-phone"
          {...register('phone', { setValueAs: emptyToUndefined })}
        />
        {errors.phone?.message ? (
          <p id={`${ids.phone}-error`} role="alert" className="text-danger-700 text-sm">
            {errors.phone.message}
          </p>
        ) : null}
      </div>

      {/* Bio (optional) */}
      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.bio}>Sobre você (opcional)</Label>
        <Textarea
          id={ids.bio}
          rows={4}
          placeholder="Uma breve descrição sobre sua atuação."
          aria-invalid={errors.bio ? true : undefined}
          aria-describedby={errors.bio ? `${ids.bio}-error` : undefined}
          data-testid="step-profile-bio"
          {...register('bio', { setValueAs: emptyToUndefined })}
        />
        {errors.bio?.message ? (
          <p id={`${ids.bio}-error`} role="alert" className="text-danger-700 text-sm">
            {errors.bio.message}
          </p>
        ) : null}
      </div>

      {/* Photo (optional, server-validated) */}
      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.photo}>Foto de perfil (opcional)</Label>
        <input
          ref={fileInputRef}
          id={ids.photo}
          type="file"
          accept={ACCEPTED_PHOTO_MIME.join(',')}
          onChange={handlePhotoChange}
          className="hidden"
          data-testid="step-profile-photo-input"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          data-testid="step-profile-photo-button"
        >
          <ImagePlus aria-hidden="true" />
          {isUploading ? 'Enviando...' : 'Adicionar foto'}
        </Button>
        {photoName ? (
          <p className="text-text-tertiary text-sm" data-testid="step-profile-photo-name">
            {photoName}
          </p>
        ) : (
          <p className="text-text-tertiary text-xs">JPEG, PNG ou WebP, até 5MB.</p>
        )}
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={isPending}
        data-testid="step-profile-submit"
        className="self-start"
      >
        {isPending ? 'Salvando...' : 'Continuar'}
      </Button>
    </form>
  );
}
