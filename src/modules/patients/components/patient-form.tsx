'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ArrowLeft, ArrowRight, Loader2, Plus, Trash2, Upload, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState, useTransition } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';

import { phoneNumberSchema } from '@/modules/whatsapp/lib/phone-number-schema';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Switch } from '@/shared/ui/switch';
import { Textarea } from '@/shared/ui/textarea';

import {
  GENDERS,
  GENDER_LABELS,
  MARITAL_STATUSES,
  MARITAL_STATUS_LABELS,
  PATIENT_TYPES,
  PATIENT_TYPE_LABELS,
  SOURCES,
  SOURCE_LABELS,
} from '../lib/patient-types';
import { isValidBrazilianPhone, isValidCpf, maskPhone } from '../lib/patient-validators';

import { PhoneInput } from './phone-input';

// ---------------------------------------------------------------------------
// Form schema — client-side with user-friendly pt-BR messages
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Guardian sub-schema (inline for the form — matches createGuardianSchema shape)
// ---------------------------------------------------------------------------

const guardianFormSchema = z.object({
  fullName: z
    .string({ message: 'Informe o nome do responsável.' })
    .trim()
    .min(2, { message: 'O nome deve ter pelo menos 2 caracteres.' })
    .max(200, { message: 'O nome deve ter no máximo 200 caracteres.' }),
  relationship: z
    .string({ message: 'Informe o parentesco.' })
    .trim()
    .min(2, { message: 'O parentesco deve ter pelo menos 2 caracteres.' })
    .max(100, { message: 'O parentesco deve ter no máximo 100 caracteres.' }),
  phone: z.string({ message: 'Informe o telefone.' }).refine((v) => isValidBrazilianPhone(v), {
    message: 'Telefone inválido. Use o formato +55 DD NNNNN-NNNN.',
  }),
  cpf: z
    .string()
    .optional()
    .refine((v) => !v || v === '' || isValidCpf(v), {
      message: 'CPF inválido.',
    }),
  email: z.string().email({ message: 'E-mail inválido.' }).max(255).optional().or(z.literal('')),
});

// Type inferred from guardianFormSchema — used implicitly by useFieldArray

// ---------------------------------------------------------------------------
// Partner sub-schema (for couple patients)
// ---------------------------------------------------------------------------

const partnerFormSchema = z.object({
  fullName: z
    .string({ message: 'Informe o nome do parceiro(a).' })
    .trim()
    .min(2, { message: 'O nome deve ter pelo menos 2 caracteres.' })
    .max(200, { message: 'O nome deve ter no máximo 200 caracteres.' }),
  phone: z
    .string()
    .optional()
    .refine((v) => !v || v === '' || isValidBrazilianPhone(v), {
      message: 'Telefone inválido. Use o formato +55 DD NNNNN-NNNN.',
    }),
  useBirthDate: z.boolean(),
  birthDate: z.string().optional(),
  approximateAge: z.string().max(20).optional(),
});

// Type inferred from partnerFormSchema — used implicitly by partner sub-form

/**
 * Step 1 schema: essential fields required to create a patient.
 * Includes conditional guardian/partner sub-forms.
 */
const step1Schema = z
  .object({
    fullName: z
      .string({ message: 'Informe o nome completo.' })
      .trim()
      .min(2, { message: 'O nome deve ter pelo menos 2 caracteres.' })
      .max(200, { message: 'O nome deve ter no máximo 200 caracteres.' }),
    patientType: z.enum(PATIENT_TYPES, {
      message: 'Selecione o tipo de paciente.',
    }),
    useBirthDate: z.boolean(),
    birthDate: z.string().optional(),
    approximateAge: z.string().max(20).optional(),
    phone: z
      .string()
      .optional()
      .refine((v) => !v || v === '' || isValidBrazilianPhone(v), {
        message: 'Telefone inválido. Use o formato (11) 98765-4321.',
      }),
    // WhatsApp opt-out controls
    whatsappOptOut: z.boolean(),
    whatsappOptOutReason: z.string().max(500).optional(),
    reminderPhone: z
      .string()
      .optional()
      .refine(
        (v) => {
          if (!v || v === '') return true;
          // Strip display mask to E.164 before validating
          const digits = v.replace(/\D/g, '');
          const e164 = digits.startsWith('55') ? `+${digits}` : `+55${digits}`;
          return phoneNumberSchema.safeParse(e164).success;
        },
        {
          message: 'Telefone inválido. Use o formato +55 (DD) NNNNN-NNNN.',
        },
      ),
    // Guardian array for minor patients (child/adolescent)
    guardians: z.array(guardianFormSchema).max(2).optional(),
    // Partner data for couple patients
    partner: partnerFormSchema.optional(),
  })
  .superRefine((data, ctx) => {
    // Require at least one age identifier when useBirthDate is toggled
    if (data.useBirthDate && data.birthDate) {
      const d = new Date(data.birthDate);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Data de nascimento inválida.',
          path: ['birthDate'],
        });
      }
    }

    // Conditional: child/adolescent requires at least 1 guardian
    if (data.patientType === 'child' || data.patientType === 'adolescent') {
      if (!data.guardians || data.guardians.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Pacientes menores precisam de pelo menos 1 responsável.',
          path: ['guardians'],
        });
      }
    }

    // Conditional: couple requires partner data
    if (data.patientType === 'couple') {
      if (!data.partner || !data.partner.fullName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Preencha os dados do parceiro(a).',
          path: ['partner'],
        });
      }
    }
  });

/**
 * Step 2 schema: optional details.
 */
const step2Schema = z.object({
  gender: z.enum(GENDERS, { message: 'Gênero inválido.' }).optional().or(z.literal('')),
  email: z.string().email({ message: 'E-mail inválido.' }).max(255).optional().or(z.literal('')),
  cpf: z
    .string()
    .optional()
    .refine((v) => !v || v === '' || isValidCpf(v), {
      message: 'CPF inválido.',
    }),
  street: z.string().max(200).optional(),
  number: z.string().max(20).optional(),
  complement: z.string().max(100).optional(),
  neighborhood: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(2).optional(),
  zipCode: z.string().max(10).optional(),
  profession: z.string().max(100).optional(),
  maritalStatus: z
    .enum(MARITAL_STATUSES, { message: 'Estado civil inválido.' })
    .optional()
    .or(z.literal('')),
  source: z.enum(SOURCES, { message: 'Origem inválida.' }).optional().or(z.literal('')),
  tags: z.string().optional(),
  notes: z
    .string()
    .max(5000, { message: 'Anotações devem ter no máximo 5000 caracteres.' })
    .optional(),
});

type Step1Data = z.infer<typeof step1Schema>;
type Step2Data = z.infer<typeof step2Schema>;

// ---------------------------------------------------------------------------
// Mask utilities
// ---------------------------------------------------------------------------

/**
 * Formats a CPF input progressively into `XXX.XXX.XXX-XX`.
 */
function maskCpf(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Common result shape for form submission actions. */
interface FormActionResult {
  ok: boolean;
  patientId?: string;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  message?: string;
}

/** Result shape for addGuardian action. */
interface AddGuardianActionResult {
  ok: boolean;
  guardianId?: string;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  message?: string;
}

/** Result shape for createCouplePatient action. */
interface CreateCoupleActionResult {
  ok: boolean;
  patientAId?: string;
  patientBId?: string;
  coupleId?: string;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  message?: string;
}

interface PatientFormCreateProps {
  mode?: 'create';
  /** Server Action to call on submit (createPatient) */
  createAction: (input: unknown) => Promise<FormActionResult>;
  /** Server Action to add a guardian to a minor patient */
  addGuardianAction?: (patientId: string, input: unknown) => Promise<AddGuardianActionResult>;
  /** Server Action to create a couple patient atomically */
  createCoupleAction?: (partnerA: unknown, partnerB: unknown) => Promise<CreateCoupleActionResult>;
  updateAction?: never;
  patient?: never;
  onSuccess?: never;
}

interface PatientFormEditProps {
  mode: 'edit';
  /** Server Action to call on submit (updatePatient) */
  updateAction: (patientId: string, input: unknown) => Promise<FormActionResult>;
  /** Patient data to pre-fill the form */
  patient: {
    id: string;
    fullName: string;
    patientType: string;
    birthDate: Date | null;
    approximateAge: string | null;
    phone: string | null;
    gender: string | null;
    email: string | null;
    cpf: string | null;
    address: string | null;
    profession: string | null;
    maritalStatus: string | null;
    source: string | null;
    tags: string[];
    notes: string | null;
    whatsappOptOut: boolean;
    reminderPhone: string | null;
  };
  /** Callback on successful save (e.g. to show toast + redirect) */
  onSuccess?: () => void;
  createAction?: never;
  addGuardianAction?: never;
  createCoupleAction?: never;
}

type PatientFormProps = PatientFormCreateProps | PatientFormEditProps;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * PatientForm — 2-step wizard for creating a patient.
 *
 * Step 1: essential info (name, type, birth/age, phone).
 * Step 2: optional details (gender, email, CPF, address, etc.).
 *
 * Design System Salvia:
 *   - Validation on blur (not onChange)
 *   - Errors inline with AlertCircle icon + message in danger-700
 *   - BR masks for phone and CPF
 *   - Labels always with for/id, gap label->input space-2
 *   - Primary CTA "Salvar" with loading state
 *   - "Proximo" as secondary, "Pular" as ghost
 *   - Mobile: single column
 */
export function PatientForm(props: PatientFormProps) {
  const { mode = 'create' } = props;
  const isEdit = mode === 'edit';
  const patient = isEdit ? props.patient : undefined;

  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse address from JSON string (edit mode)
  const parsedAddress = (() => {
    if (!patient?.address) return undefined;
    try {
      return JSON.parse(patient.address) as Record<string, string>;
    } catch {
      return undefined;
    }
  })();

  // Step 1 form
  const step1Form = useForm<Step1Data>({
    resolver: zodResolver(step1Schema),
    mode: 'onBlur',
    defaultValues: {
      fullName: patient?.fullName ?? '',
      patientType: (patient?.patientType as Step1Data['patientType']) ?? undefined,
      useBirthDate: patient ? Boolean(patient.birthDate) : true,
      birthDate: patient?.birthDate ? patient.birthDate.toISOString().split('T')[0] : '',
      approximateAge: patient?.approximateAge ?? '',
      phone: patient?.phone ?? '',
      whatsappOptOut: patient?.whatsappOptOut ?? false,
      whatsappOptOutReason: '',
      // Prefill: stored reminder phones are E.164 (+55DDNNNNNNNNN). `maskPhone`
      // normalizes them to the canonical `+55 DD NNNNN-NNNN` that `PhoneInput`
      // expects as its controlled `value` (it derives the editable national text
      // internally), so this is the one remaining `maskPhone` call site.
      reminderPhone: patient?.reminderPhone ? maskPhone(patient.reminderPhone) : '',
      guardians: [],
      partner: undefined,
    },
  });

  // useFieldArray for guardians (child/adolescent patients)
  const {
    fields: guardianFields,
    append: appendGuardian,
    remove: removeGuardian,
  } = useFieldArray({
    control: step1Form.control,
    name: 'guardians',
  });

  // Watch patient type to show/hide conditional sections
  const watchedPatientType = step1Form.watch('patientType');

  // Watch opt-out to show/hide conditional fields
  const watchedOptOut = step1Form.watch('whatsappOptOut');

  // Step 2 form
  const step2Form = useForm<Step2Data>({
    resolver: zodResolver(step2Schema),
    mode: 'onBlur',
    defaultValues: {
      gender: (patient?.gender as Step2Data['gender']) ?? '',
      email: patient?.email ?? '',
      cpf: patient?.cpf ?? '',
      street: parsedAddress?.street ?? '',
      number: parsedAddress?.number ?? '',
      complement: parsedAddress?.complement ?? '',
      neighborhood: parsedAddress?.neighborhood ?? '',
      city: parsedAddress?.city ?? '',
      state: parsedAddress?.state ?? '',
      zipCode: parsedAddress?.zipCode ?? '',
      profession: patient?.profession ?? '',
      maritalStatus: (patient?.maritalStatus as Step2Data['maritalStatus']) ?? '',
      source: (patient?.source as Step2Data['source']) ?? '',
      tags: patient?.tags?.join(', ') ?? '',
      notes: patient?.notes ?? '',
    },
  });

  // Step 1 -> Step 2 transition
  const handleNext = useCallback(() => {
    void step1Form.handleSubmit(() => {
      setStep(2);
    })();
  }, [step1Form]);

  // Back to step 1
  const handleBack = useCallback(() => {
    setStep(1);
  }, []);

  // Submit (from step 2 "Salvar" or "Pular" from step 2)
  const handleSubmit = useCallback(
    (skipStep2: boolean) => {
      const submitFn = () => {
        const s1 = step1Form.getValues();
        const s2 = skipStep2
          ? {
              gender: '',
              email: '',
              cpf: '',
              street: '',
              number: '',
              complement: '',
              neighborhood: '',
              city: '',
              state: '',
              zipCode: '',
              profession: '',
              maritalStatus: '',
              source: '',
              tags: '',
              notes: '',
            }
          : step2Form.getValues();

        // Build the payload for the server action
        const payload: Record<string, unknown> = {
          fullName: s1.fullName,
          patientType: s1.patientType,
        };

        // Birth date or approximate age
        if (s1.useBirthDate && s1.birthDate) {
          payload.birthDate = s1.birthDate;
        } else if (!s1.useBirthDate && s1.approximateAge) {
          payload.approximateAge = s1.approximateAge;
        }

        // Phone
        if (s1.phone) {
          payload.phone = s1.phone;
        }

        // WhatsApp opt-out controls
        payload.whatsapp_opt_out = s1.whatsappOptOut;
        if (s1.reminderPhone && s1.reminderPhone !== '') {
          // Convert display mask (+55 DD NNNNN-NNNN) to E.164 (+55DDNNNNNNNNN)
          const digits = s1.reminderPhone.replace(/\D/g, '');
          payload.reminder_phone = digits.startsWith('55') ? `+${digits}` : `+55${digits}`;
        } else {
          payload.reminder_phone = null;
        }

        // Step 2 fields (only if not skipped and non-empty)
        if (!skipStep2) {
          if (s2.gender && s2.gender !== '') payload.gender = s2.gender;
          if (s2.email && s2.email !== '') payload.email = s2.email;
          if (s2.cpf && s2.cpf !== '') payload.cpf = s2.cpf;
          if (s2.profession && s2.profession !== '') payload.profession = s2.profession;
          if (s2.maritalStatus && s2.maritalStatus !== '') payload.maritalStatus = s2.maritalStatus;
          if (s2.source && s2.source !== '') payload.source = s2.source;
          if (s2.notes && s2.notes !== '') payload.notes = s2.notes;

          // Tags: split by comma
          if (s2.tags && s2.tags.trim() !== '') {
            payload.tags = s2.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean);
          }

          // Address
          const address: Record<string, string> = {};
          if (s2.street) address.street = s2.street;
          if (s2.number) address.number = s2.number;
          if (s2.complement) address.complement = s2.complement;
          if (s2.neighborhood) address.neighborhood = s2.neighborhood;
          if (s2.city) address.city = s2.city;
          if (s2.state) address.state = s2.state;
          if (s2.zipCode) address.zipCode = s2.zipCode;
          if (Object.keys(address).length > 0) payload.address = address;
        }

        setServerError(null);

        startTransition(async () => {
          if (isEdit && props.updateAction && patient) {
            // Edit mode: call updateAction
            const result = await props.updateAction(patient.id, payload);
            if (result.ok) {
              props.onSuccess?.();
              router.push(`/pacientes/${patient.id}`);
            } else {
              if (result.error === 'invalid_input' && result.fieldErrors) {
                Object.entries(result.fieldErrors).forEach(([field, messages]) => {
                  const msg = messages[0] ?? 'Campo inválido.';
                  if (field in step1Form.getValues()) {
                    step1Form.setError(field as keyof Step1Data, { message: msg });
                    setStep(1);
                  } else {
                    step2Form.setError(field as keyof Step2Data, { message: msg });
                  }
                });
              } else {
                setServerError(result.message ?? 'Erro inesperado ao atualizar paciente.');
              }
            }
            return;
          }

          // Create mode — three paths based on patient type:
          // 1. Couple → createCoupleAction (atomic insert of both partners)
          // 2. Minor (child/adolescent) → createAction + addGuardianAction per guardian
          // 3. Normal → createAction

          if (s1.patientType === 'couple' && props.createCoupleAction) {
            // Build partner payload from the partner sub-form
            const partnerData = s1.partner;
            const partnerPayload: Record<string, unknown> = {
              fullName: partnerData?.fullName ?? '',
            };
            if (partnerData?.phone) partnerPayload.phone = partnerData.phone;
            if (partnerData?.useBirthDate && partnerData.birthDate) {
              partnerPayload.birthDate = partnerData.birthDate;
            } else if (!partnerData?.useBirthDate && partnerData?.approximateAge) {
              partnerPayload.approximateAge = partnerData.approximateAge;
            }

            const coupleResult = await props.createCoupleAction(payload, partnerPayload);
            if (coupleResult.ok && coupleResult.patientAId) {
              router.push(`/pacientes/${coupleResult.patientAId}`);
            } else {
              setServerError(coupleResult.message ?? 'Erro inesperado ao criar casal.');
            }
            return;
          }

          if (props.createAction) {
            const result = await props.createAction(payload);
            if (result.ok && result.patientId) {
              // If minor patient, add guardians sequentially
              const isMinor = s1.patientType === 'child' || s1.patientType === 'adolescent';
              if (isMinor && props.addGuardianAction && s1.guardians && s1.guardians.length > 0) {
                for (const guardian of s1.guardians) {
                  const guardianResult = await props.addGuardianAction(result.patientId, {
                    fullName: guardian.fullName,
                    relationship: guardian.relationship,
                    phone: guardian.phone,
                    cpf: guardian.cpf || undefined,
                    email: guardian.email || undefined,
                  });
                  if (!guardianResult.ok) {
                    // Guardian failed — patient is created but guardian not attached.
                    // Redirect to patient detail so user can add guardians manually.
                    setServerError(
                      guardianResult.message ??
                        `Paciente criado, mas houve erro ao adicionar responsável "${guardian.fullName}".`,
                    );
                    router.push(`/pacientes/${result.patientId}`);
                    return;
                  }
                }
              }
              router.push(`/pacientes/${result.patientId}`);
            } else {
              if (result.error === 'invalid_input' && result.fieldErrors) {
                Object.entries(result.fieldErrors).forEach(([field, messages]) => {
                  const msg = messages[0] ?? 'Campo inválido.';
                  if (field in step1Form.getValues()) {
                    step1Form.setError(field as keyof Step1Data, { message: msg });
                    setStep(1);
                  } else {
                    step2Form.setError(field as keyof Step2Data, { message: msg });
                  }
                });
              } else {
                setServerError(result.message ?? 'Erro inesperado ao criar paciente.');
              }
            }
          }
        });
      };

      if (skipStep2) {
        // Validate step 1 before submitting (safety net)
        void step1Form.handleSubmit(submitFn)();
      } else {
        // Validate step 2 first
        void step2Form.handleSubmit(submitFn)();
      }
    },
    [step1Form, step2Form, props, patient, isEdit, router, startTransition],
  );

  // Photo handling
  const handlePhotoChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      // 2MB limit
      setServerError('A foto deve ter no máximo 2MB.');
      return;
    }
    setPhotoPreview(URL.createObjectURL(file));
  }, []);

  const removePhoto = useCallback(() => {
    if (photoPreview) {
      URL.revokeObjectURL(photoPreview);
      setPhotoPreview(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [photoPreview]);

  return (
    <div className="mx-auto w-full max-w-[640px]" data-testid="patient-form">
      {/* Step indicator */}
      <div className="mb-8 flex items-center gap-3" aria-label="Progresso do formulário">
        <StepIndicator step={1} current={step} label="Dados essenciais" />
        <div className="bg-border h-px flex-1" />
        <StepIndicator step={2} current={step} label="Detalhes opcionais" />
      </div>

      {/* Server error banner */}
      {serverError && (
        <div
          className="bg-danger-50 text-danger-700 mb-6 flex items-start gap-2 rounded-md p-4 text-sm"
          role="alert"
          data-testid="patient-form-error"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{serverError}</span>
        </div>
      )}

      {/* Step 1 */}
      {step === 1 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleNext();
          }}
          className="space-y-6"
          data-testid="patient-form-step1"
          noValidate
        >
          {/* Full name */}
          <FormField
            id="fullName"
            label="Nome completo"
            error={step1Form.formState.errors.fullName?.message}
            required
          >
            <Input
              id="fullName-form-item"
              placeholder="Nome completo do paciente"
              aria-invalid={Boolean(step1Form.formState.errors.fullName)}
              data-testid="patient-form-fullname"
              {...step1Form.register('fullName')}
            />
          </FormField>

          {/* Patient type */}
          <FormField
            id="patientType"
            label="Tipo de paciente"
            error={step1Form.formState.errors.patientType?.message}
            required
          >
            <Select
              value={step1Form.watch('patientType') ?? ''}
              onValueChange={(value) => {
                const typed = value as Step1Data['patientType'];
                step1Form.setValue('patientType', typed, {
                  shouldValidate: true,
                });

                // When switching to couple, initialize partner with empty defaults
                // so the sub-form fields are registered — but don't trigger validation
                // to avoid showing errors before the user interacts with the fields.
                if (typed === 'couple') {
                  step1Form.setValue(
                    'partner',
                    {
                      fullName: '',
                      phone: '',
                      useBirthDate: true,
                      birthDate: '',
                      approximateAge: '',
                    },
                    { shouldValidate: false },
                  );
                } else {
                  // Clear partner data when switching away from couple
                  step1Form.setValue('partner', undefined, { shouldValidate: false });
                }

                // Clear any stale partner validation errors when switching types
                step1Form.clearErrors('partner');
              }}
            >
              <SelectTrigger
                id="patientType-form-item"
                aria-invalid={Boolean(step1Form.formState.errors.patientType)}
                data-testid="patient-form-type"
              >
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {PATIENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {PATIENT_TYPE_LABELS[type] ?? type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          {/* Birth date / Approximate age toggle */}
          <div className="space-y-2">
            <div className="flex items-center gap-4">
              <button
                type="button"
                className={`text-sm font-medium ${step1Form.watch('useBirthDate') ? 'text-brand-700 underline' : 'text-text-secondary'}`}
                onClick={() => step1Form.setValue('useBirthDate', true)}
                data-testid="patient-form-use-birthdate"
              >
                Data de nascimento
              </button>
              <button
                type="button"
                className={`text-sm font-medium ${!step1Form.watch('useBirthDate') ? 'text-brand-700 underline' : 'text-text-secondary'}`}
                onClick={() => step1Form.setValue('useBirthDate', false)}
                data-testid="patient-form-use-age"
              >
                Idade aproximada
              </button>
            </div>

            {step1Form.watch('useBirthDate') ? (
              <FormField
                id="birthDate"
                label=""
                error={step1Form.formState.errors.birthDate?.message}
              >
                <Input
                  id="birthDate-form-item"
                  type="date"
                  max={new Date().toISOString().split('T')[0]}
                  aria-invalid={Boolean(step1Form.formState.errors.birthDate)}
                  data-testid="patient-form-birthdate"
                  {...step1Form.register('birthDate')}
                />
              </FormField>
            ) : (
              <FormField
                id="approximateAge"
                label=""
                error={step1Form.formState.errors.approximateAge?.message}
              >
                <Input
                  id="approximateAge-form-item"
                  type="text"
                  placeholder="Ex: 35 anos"
                  aria-invalid={Boolean(step1Form.formState.errors.approximateAge)}
                  data-testid="patient-form-age"
                  {...step1Form.register('approximateAge')}
                />
              </FormField>
            )}
          </div>

          {/* Phone (masked) */}
          <FormField id="phone" label="Telefone" error={step1Form.formState.errors.phone?.message}>
            <PhoneInput
              id="phone-form-item"
              placeholder="11 91234-5678"
              aria-invalid={Boolean(step1Form.formState.errors.phone)}
              data-testid="patient-form-phone"
              value={step1Form.watch('phone') ?? ''}
              onChange={(value) => {
                step1Form.setValue('phone', value, { shouldValidate: false });
              }}
              onBlur={() => {
                void step1Form.trigger('phone');
              }}
            />
          </FormField>

          {/* WhatsApp reminders section */}
          <fieldset className="space-y-4" data-testid="whatsapp-reminders-section">
            <legend className="text-text-secondary text-xs font-medium tracking-[0.06em] uppercase">
              Lembretes WhatsApp
            </legend>

            {/* Switch: opt-in/opt-out */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="whatsapp-opt-out-switch" className="text-sm font-medium">
                  Receber lembretes via WhatsApp
                </Label>
                <p className="text-text-tertiary text-[13px]">
                  Quando desativado, nenhum lembrete será enviado a este paciente
                </p>
              </div>
              <Switch
                id="whatsapp-opt-out-switch"
                checked={!watchedOptOut}
                onCheckedChange={(checked) => {
                  step1Form.setValue('whatsappOptOut', !checked, { shouldValidate: false });
                }}
                aria-label="Receber lembretes via WhatsApp"
              />
            </div>

            {/* Conditional fields when opted out */}
            {watchedOptOut && (
              <div className="space-y-4" aria-live="polite">
                {/* Opt-out reason */}
                <FormField
                  id="whatsappOptOutReason"
                  label="Motivo (visível só para você)"
                  error={step1Form.formState.errors.whatsappOptOutReason?.message}
                >
                  <Textarea
                    id="whatsappOptOutReason-form-item"
                    rows={2}
                    placeholder="Ex.: Paciente pediu para não receber mensagens"
                    aria-invalid={Boolean(step1Form.formState.errors.whatsappOptOutReason)}
                    data-testid="whatsapp-opt-out-reason"
                    {...step1Form.register('whatsappOptOutReason')}
                  />
                </FormField>
              </div>
            )}

            {/* Reminder phone — always visible, independent of opt-out */}
            <FormField
              id="reminderPhone"
              label="Telefone alternativo para lembretes"
              error={step1Form.formState.errors.reminderPhone?.message}
            >
              <PhoneInput
                id="reminderPhone-form-item"
                placeholder="11 91234-5678"
                aria-invalid={Boolean(step1Form.formState.errors.reminderPhone)}
                data-testid="reminder-phone"
                value={step1Form.watch('reminderPhone') ?? ''}
                onChange={(value) => {
                  step1Form.setValue('reminderPhone', value, { shouldValidate: false });
                }}
                onBlur={() => {
                  void step1Form.trigger('reminderPhone');
                }}
              />
              <p className="text-text-tertiary text-[13px]">
                Use para enviar lembretes ao responsável (ex.: pai/mãe de menor)
              </p>
            </FormField>
          </fieldset>

          {/* Guardians section — visible for child/adolescent */}
          {(watchedPatientType === 'child' || watchedPatientType === 'adolescent') && (
            <div className="space-y-4" data-testid="guardians-section">
              <div className="flex items-center justify-between">
                <h4 className="text-text-primary text-base font-medium">Responsáveis</h4>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={guardianFields.length >= 2}
                  data-testid="add-guardian-btn"
                  onClick={() =>
                    appendGuardian({
                      fullName: '',
                      relationship: '',
                      phone: '',
                      cpf: '',
                      email: '',
                    })
                  }
                >
                  <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                  Adicionar responsável
                </Button>
              </div>

              {/* Top-level guardian validation error */}
              {step1Form.formState.errors.guardians?.message && (
                <p className="text-danger-700 flex items-center gap-1 text-sm" role="alert">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {step1Form.formState.errors.guardians.message}
                </p>
              )}

              {guardianFields.map((field, index) => (
                <Card
                  key={field.id}
                  className="bg-surface rounded-xl border p-6 shadow-none"
                  data-testid={`guardian-card-${index}`}
                >
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-text-primary text-base font-medium">
                      Responsável {index + 1}
                    </h4>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-danger-700 hover:text-danger-500"
                      onClick={() => removeGuardian(index)}
                      data-testid={`remove-guardian-${index}`}
                      aria-label={`Remover responsável ${index + 1}`}
                    >
                      <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
                      Remover
                    </Button>
                  </div>

                  <div className="space-y-4">
                    {/* Guardian full name */}
                    <FormField
                      id={`guardian-${index}-fullName`}
                      label="Nome completo"
                      error={step1Form.formState.errors.guardians?.[index]?.fullName?.message}
                      required
                    >
                      <Input
                        id={`guardian-${index}-fullName-form-item`}
                        placeholder="Nome do responsável"
                        aria-invalid={Boolean(
                          step1Form.formState.errors.guardians?.[index]?.fullName,
                        )}
                        data-testid={`guardian-${index}-fullname`}
                        {...step1Form.register(`guardians.${index}.fullName`)}
                      />
                    </FormField>

                    {/* Guardian relationship */}
                    <FormField
                      id={`guardian-${index}-relationship`}
                      label="Parentesco"
                      error={step1Form.formState.errors.guardians?.[index]?.relationship?.message}
                      required
                    >
                      <Input
                        id={`guardian-${index}-relationship-form-item`}
                        placeholder="Ex: Mãe, Pai, Tio(a)"
                        aria-invalid={Boolean(
                          step1Form.formState.errors.guardians?.[index]?.relationship,
                        )}
                        data-testid={`guardian-${index}-relationship`}
                        {...step1Form.register(`guardians.${index}.relationship`)}
                      />
                    </FormField>

                    {/* Guardian phone (masked) */}
                    <FormField
                      id={`guardian-${index}-phone`}
                      label="Telefone"
                      error={step1Form.formState.errors.guardians?.[index]?.phone?.message}
                      required
                    >
                      <PhoneInput
                        id={`guardian-${index}-phone-form-item`}
                        placeholder="11 91234-5678"
                        aria-invalid={Boolean(step1Form.formState.errors.guardians?.[index]?.phone)}
                        data-testid={`guardian-${index}-phone`}
                        value={step1Form.watch(`guardians.${index}.phone`) ?? ''}
                        onChange={(value) => {
                          step1Form.setValue(`guardians.${index}.phone`, value, {
                            shouldValidate: false,
                          });
                        }}
                        onBlur={() => {
                          void step1Form.trigger(`guardians.${index}.phone`);
                        }}
                      />
                    </FormField>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {/* Guardian CPF (optional, masked) */}
                      <FormField
                        id={`guardian-${index}-cpf`}
                        label="CPF"
                        error={step1Form.formState.errors.guardians?.[index]?.cpf?.message}
                      >
                        <Input
                          id={`guardian-${index}-cpf-form-item`}
                          type="text"
                          placeholder="000.000.000-00"
                          aria-invalid={Boolean(step1Form.formState.errors.guardians?.[index]?.cpf)}
                          data-testid={`guardian-${index}-cpf`}
                          value={step1Form.watch(`guardians.${index}.cpf`) ?? ''}
                          onChange={(e) => {
                            const masked = maskCpf(e.target.value);
                            step1Form.setValue(`guardians.${index}.cpf`, masked, {
                              shouldValidate: false,
                            });
                          }}
                          onBlur={() => {
                            void step1Form.trigger(`guardians.${index}.cpf`);
                          }}
                        />
                      </FormField>

                      {/* Guardian email (optional) */}
                      <FormField
                        id={`guardian-${index}-email`}
                        label="E-mail"
                        error={step1Form.formState.errors.guardians?.[index]?.email?.message}
                      >
                        <Input
                          id={`guardian-${index}-email-form-item`}
                          type="email"
                          placeholder="responsavel@email.com"
                          aria-invalid={Boolean(
                            step1Form.formState.errors.guardians?.[index]?.email,
                          )}
                          data-testid={`guardian-${index}-email`}
                          {...step1Form.register(`guardians.${index}.email`)}
                        />
                      </FormField>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Partner section — visible for couple */}
          {watchedPatientType === 'couple' && (
            <Card
              className="bg-surface rounded-xl border p-6 shadow-none"
              data-testid="partner-section"
            >
              <h4 className="text-text-primary mb-4 text-base font-medium">Parceiro(a)</h4>

              {/* Top-level partner validation error */}
              {step1Form.formState.errors.partner?.message && (
                <p className="text-danger-700 mb-4 flex items-center gap-1 text-sm" role="alert">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {step1Form.formState.errors.partner.message}
                </p>
              )}

              <div className="space-y-4">
                {/* Partner full name */}
                <FormField
                  id="partner-fullName"
                  label="Nome completo"
                  error={step1Form.formState.errors.partner?.fullName?.message}
                  required
                >
                  <Input
                    id="partner-fullName-form-item"
                    placeholder="Nome completo do parceiro(a)"
                    aria-invalid={Boolean(step1Form.formState.errors.partner?.fullName)}
                    data-testid="partner-fullname"
                    {...step1Form.register('partner.fullName')}
                  />
                </FormField>

                {/* Partner phone (optional, masked) */}
                <FormField
                  id="partner-phone"
                  label="Telefone"
                  error={step1Form.formState.errors.partner?.phone?.message}
                >
                  <PhoneInput
                    id="partner-phone-form-item"
                    placeholder="11 91234-5678"
                    aria-invalid={Boolean(step1Form.formState.errors.partner?.phone)}
                    data-testid="partner-phone"
                    value={step1Form.watch('partner.phone') ?? ''}
                    onChange={(value) => {
                      step1Form.setValue('partner.phone', value, { shouldValidate: false });
                    }}
                    onBlur={() => {
                      void step1Form.trigger('partner.phone');
                    }}
                  />
                </FormField>

                {/* Partner birth date / approximate age toggle */}
                <div className="space-y-2">
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      className={`text-sm font-medium ${step1Form.watch('partner.useBirthDate') ? 'text-brand-700 underline' : 'text-text-secondary'}`}
                      onClick={() => step1Form.setValue('partner.useBirthDate', true)}
                      data-testid="partner-use-birthdate"
                    >
                      Data de nascimento
                    </button>
                    <button
                      type="button"
                      className={`text-sm font-medium ${!step1Form.watch('partner.useBirthDate') ? 'text-brand-700 underline' : 'text-text-secondary'}`}
                      onClick={() => step1Form.setValue('partner.useBirthDate', false)}
                      data-testid="partner-use-age"
                    >
                      Idade aproximada
                    </button>
                  </div>

                  {step1Form.watch('partner.useBirthDate') ? (
                    <FormField
                      id="partner-birthDate"
                      label=""
                      error={step1Form.formState.errors.partner?.birthDate?.message}
                    >
                      <Input
                        id="partner-birthDate-form-item"
                        type="date"
                        max={new Date().toISOString().split('T')[0]}
                        aria-invalid={Boolean(step1Form.formState.errors.partner?.birthDate)}
                        data-testid="partner-birthdate"
                        {...step1Form.register('partner.birthDate')}
                      />
                    </FormField>
                  ) : (
                    <FormField
                      id="partner-approximateAge"
                      label=""
                      error={step1Form.formState.errors.partner?.approximateAge?.message}
                    >
                      <Input
                        id="partner-approximateAge-form-item"
                        type="text"
                        placeholder="Ex: 35 anos"
                        aria-invalid={Boolean(step1Form.formState.errors.partner?.approximateAge)}
                        data-testid="partner-age"
                        {...step1Form.register('partner.approximateAge')}
                      />
                    </FormField>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <Button type="submit" variant="secondary" data-testid="patient-form-next">
              Próximo
              <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </form>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(false);
          }}
          className="space-y-6"
          data-testid="patient-form-step2"
          noValidate
        >
          {/* Gender */}
          <FormField id="gender" label="Gênero" error={step2Form.formState.errors.gender?.message}>
            <Select
              value={step2Form.watch('gender') ?? ''}
              onValueChange={(value) => {
                step2Form.setValue('gender', value as Step2Data['gender'], {
                  shouldValidate: true,
                });
              }}
            >
              <SelectTrigger
                id="gender-form-item"
                aria-invalid={Boolean(step2Form.formState.errors.gender)}
                data-testid="patient-form-gender"
              >
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {GENDERS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {GENDER_LABELS[g] ?? g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          {/* Email */}
          <FormField id="email" label="E-mail" error={step2Form.formState.errors.email?.message}>
            <Input
              id="email-form-item"
              type="email"
              placeholder="paciente@email.com"
              aria-invalid={Boolean(step2Form.formState.errors.email)}
              data-testid="patient-form-email"
              {...step2Form.register('email')}
            />
          </FormField>

          {/* CPF (masked) */}
          <FormField id="cpf" label="CPF" error={step2Form.formState.errors.cpf?.message}>
            <Input
              id="cpf-form-item"
              type="text"
              placeholder="000.000.000-00"
              aria-invalid={Boolean(step2Form.formState.errors.cpf)}
              data-testid="patient-form-cpf"
              value={step2Form.watch('cpf') ?? ''}
              onChange={(e) => {
                const masked = maskCpf(e.target.value);
                step2Form.setValue('cpf', masked, { shouldValidate: false });
              }}
              onBlur={() => {
                void step2Form.trigger('cpf');
              }}
            />
          </FormField>

          {/* Address section */}
          <fieldset className="space-y-4">
            <legend className="text-text-primary text-sm font-medium">Endereço</legend>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                id="zipCode"
                label="CEP"
                error={step2Form.formState.errors.zipCode?.message}
              >
                <Input
                  id="zipCode-form-item"
                  placeholder="00000-000"
                  data-testid="patient-form-zipcode"
                  {...step2Form.register('zipCode')}
                />
              </FormField>

              <FormField id="state" label="UF" error={step2Form.formState.errors.state?.message}>
                <Input
                  id="state-form-item"
                  placeholder="SP"
                  maxLength={2}
                  data-testid="patient-form-state"
                  {...step2Form.register('state')}
                />
              </FormField>
            </div>

            <FormField id="street" label="Rua" error={step2Form.formState.errors.street?.message}>
              <Input
                id="street-form-item"
                placeholder="Rua, Avenida..."
                data-testid="patient-form-street"
                {...step2Form.register('street')}
              />
            </FormField>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FormField
                id="number"
                label="Número"
                error={step2Form.formState.errors.number?.message}
              >
                <Input
                  id="number-form-item"
                  placeholder="123"
                  data-testid="patient-form-number"
                  {...step2Form.register('number')}
                />
              </FormField>

              <FormField
                id="complement"
                label="Complemento"
                error={step2Form.formState.errors.complement?.message}
              >
                <Input
                  id="complement-form-item"
                  placeholder="Apto 4B"
                  data-testid="patient-form-complement"
                  {...step2Form.register('complement')}
                />
              </FormField>

              <FormField
                id="neighborhood"
                label="Bairro"
                error={step2Form.formState.errors.neighborhood?.message}
              >
                <Input
                  id="neighborhood-form-item"
                  placeholder="Centro"
                  data-testid="patient-form-neighborhood"
                  {...step2Form.register('neighborhood')}
                />
              </FormField>
            </div>

            <FormField id="city" label="Cidade" error={step2Form.formState.errors.city?.message}>
              <Input
                id="city-form-item"
                placeholder="São Paulo"
                data-testid="patient-form-city"
                {...step2Form.register('city')}
              />
            </FormField>
          </fieldset>

          {/* Profession */}
          <FormField
            id="profession"
            label="Profissão"
            error={step2Form.formState.errors.profession?.message}
          >
            <Input
              id="profession-form-item"
              placeholder="Profissão do paciente"
              data-testid="patient-form-profession"
              {...step2Form.register('profession')}
            />
          </FormField>

          {/* Marital status */}
          <FormField
            id="maritalStatus"
            label="Estado civil"
            error={step2Form.formState.errors.maritalStatus?.message}
          >
            <Select
              value={step2Form.watch('maritalStatus') ?? ''}
              onValueChange={(value) => {
                step2Form.setValue('maritalStatus', value as Step2Data['maritalStatus'], {
                  shouldValidate: true,
                });
              }}
            >
              <SelectTrigger
                id="maritalStatus-form-item"
                aria-invalid={Boolean(step2Form.formState.errors.maritalStatus)}
                data-testid="patient-form-marital"
              >
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {MARITAL_STATUSES.map((ms) => (
                  <SelectItem key={ms} value={ms}>
                    {MARITAL_STATUS_LABELS[ms] ?? ms}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          {/* Source */}
          <FormField
            id="source"
            label="Como conheceu"
            error={step2Form.formState.errors.source?.message}
          >
            <Select
              value={step2Form.watch('source') ?? ''}
              onValueChange={(value) => {
                step2Form.setValue('source', value as Step2Data['source'], {
                  shouldValidate: true,
                });
              }}
            >
              <SelectTrigger
                id="source-form-item"
                aria-invalid={Boolean(step2Form.formState.errors.source)}
                data-testid="patient-form-source"
              >
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SOURCE_LABELS[s] ?? s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          {/* Tags */}
          <FormField id="tags" label="Tags" error={step2Form.formState.errors.tags?.message}>
            <Input
              id="tags-form-item"
              placeholder="Separar por vírgula: ansiedade, terapia"
              data-testid="patient-form-tags"
              {...step2Form.register('tags')}
            />
          </FormField>

          {/* Photo upload */}
          <div className="space-y-2">
            <Label htmlFor="photo-upload">Foto</Label>
            <div className="flex items-center gap-4">
              {photoPreview ? (
                <div className="relative h-16 w-16">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoPreview}
                    alt="Preview da foto do paciente"
                    className="h-16 w-16 rounded-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={removePhoto}
                    className="bg-danger-500 text-text-inverse absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full"
                    aria-label="Remover foto"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="border-border bg-surface-sunken hover:bg-surface-muted flex h-16 w-16 items-center justify-center rounded-full border transition-colors"
                  data-testid="patient-form-photo-upload"
                  aria-label="Adicionar foto do paciente"
                >
                  <Upload className="text-text-tertiary h-5 w-5" aria-hidden="true" />
                </button>
              )}
              <input
                ref={fileInputRef}
                id="photo-upload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
              />
              <span className="text-text-tertiary text-xs">Máximo 2MB. JPG, PNG ou WebP.</span>
            </div>
          </div>

          {/* Notes */}
          <FormField id="notes" label="Anotações" error={step2Form.formState.errors.notes?.message}>
            <Textarea
              id="notes-form-item"
              placeholder="Observações sobre o paciente..."
              rows={4}
              aria-invalid={Boolean(step2Form.formState.errors.notes)}
              data-testid="patient-form-notes"
              {...step2Form.register('notes')}
            />
          </FormField>

          {/* Actions */}
          <div className="flex flex-col-reverse gap-3 pt-4 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={handleBack}
              data-testid="patient-form-back"
            >
              <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
              Voltar
            </Button>

            <div className="flex gap-3">
              {!isEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleSubmit(true)}
                  disabled={isPending}
                  data-testid="patient-form-skip"
                >
                  Pular
                </Button>
              )}
              <Button type="submit" disabled={isPending} data-testid="patient-form-save">
                {isPending ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
                    Salvando...
                  </>
                ) : (
                  'Salvar'
                )}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal helper: FormField wrapper
// ---------------------------------------------------------------------------

interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

function FormField({ id, label, error, required, children }: FormFieldProps) {
  return (
    <div className="space-y-2">
      {label && (
        <Label htmlFor={`${id}-form-item`}>
          {label}
          {required && <span className="text-danger-500 ml-0.5">*</span>}
        </Label>
      )}
      {children}
      {error && (
        <p className="text-danger-700 flex items-center gap-1 text-sm" role="alert">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

interface StepIndicatorProps {
  step: number;
  current: number;
  label: string;
}

function StepIndicator({ step, current, label }: StepIndicatorProps) {
  const isActive = step === current;
  const isCompleted = step < current;

  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
          isActive
            ? 'bg-brand-500 text-text-inverse'
            : isCompleted
              ? 'bg-brand-100 text-brand-700'
              : 'bg-surface-muted text-text-tertiary'
        }`}
      >
        {step}
      </div>
      <span
        className={`text-sm ${isActive ? 'text-text-primary font-medium' : 'text-text-tertiary'}`}
      >
        {label}
      </span>
    </div>
  );
}
