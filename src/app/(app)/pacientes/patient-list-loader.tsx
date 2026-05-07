'use client';

import type { ListPatientsResult } from '@/modules/patients';
import { PatientList } from '@/modules/patients/components/patient-list';
import type { Patient } from '@/shared/db/schema/patients/tables';

// ---------------------------------------------------------------------------
// Thin client-boundary wrapper
// ---------------------------------------------------------------------------

// This component exists solely to cross the server->client boundary. Server
// Components cannot pass a function reference (the server action) as a prop
// to a client component unless the client component itself is the boundary.
// The actual `listPatients` server action is imported in the page.tsx and
// passed here; this wrapper types the callback and delegates to PatientList.

interface PatientListLoaderProps {
  patients: Patient[];
  total: number;
  page: number;
  pageSize: number;
  listAction: (query: unknown) => Promise<ListPatientsResult>;
  availableTags?: string[];
}

export function PatientListLoader(props: PatientListLoaderProps) {
  return <PatientList {...props} />;
}
