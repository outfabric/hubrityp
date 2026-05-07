// Public API of the `patients` module.
//
// Per project conventions, every module exposes its surface through a single
// `index.ts` barrel — consumers MUST import from `@/modules/patients`, never
// from internal paths like `@/modules/patients/lib/...`.
//
// This file is intentionally NEUTRAL — no `'use server'` directive at the top
// level. The barrel re-exports Server Action implementations, pure helpers,
// types, and (future) Components; if it carried `'use server'`, every export
// would be transformed into an RPC stub by the Next.js compiler and the
// schema/type re-exports would break.
//
// The `'use server'` directives live on the route shells:
//   - `src/app/(app)/pacientes/actions.ts`
//   - `src/app/(app)/pacientes/[id]/actions.ts`
// which import from this barrel and re-export as bona fide Server Actions.

// ---- Server Actions (delegated to by the route shells) -----------------------
export { createPatientImpl, type CreatePatientResult } from './server/create-patient';
export { getPatientImpl, type GetPatientResult } from './server/get-patient';
export { updatePatientImpl, type UpdatePatientResult } from './server/update-patient';
export {
  archivePatientImpl,
  type ArchivePatientResult,
  unarchivePatientImpl,
  type UnarchivePatientResult,
} from './server/archive-patient';
export { deletePatientImpl, type DeletePatientResult } from './server/delete-patient';
export { listPatientsImpl, type ListPatientsResult } from './server/list-patients';
export {
  uploadPatientPhotoImpl,
  type UploadPatientPhotoResult,
} from './server/upload-patient-photo';
export {
  getPatientPhotoUrlImpl,
  type GetPatientPhotoUrlResult,
} from './server/get-patient-photo-url';

// ---- Zod Schemas -------------------------------------------------------------
export {
  createPatientSchema,
  updatePatientSchema,
  listPatientsQuerySchema,
} from './lib/patient-input-schema';

// ---- Types -------------------------------------------------------------------
export type {
  CreatePatientInput,
  UpdatePatientInput,
  ListPatientsQuery,
} from './lib/patient-types';
export {
  PATIENT_TYPES,
  type PatientType,
  PATIENT_STATUSES,
  type PatientStatus,
  GENDERS,
  type Gender,
  MARITAL_STATUSES,
  type MaritalStatus,
  SOURCES,
  type Source,
  SORT_COLUMNS,
  type SortColumn,
  SORT_ORDERS,
  type SortOrder,
} from './lib/patient-types';

// ---- Validators --------------------------------------------------------------
export { isValidBrazilianPhone, isValidCpf, formatPhone } from './lib/patient-validators';

// ---- Components --------------------------------------------------------------
export { PatientList } from './components/patient-list';
