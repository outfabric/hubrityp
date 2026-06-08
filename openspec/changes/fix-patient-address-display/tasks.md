## 1. Format helper

- [x] 1.1 Create `src/modules/patients/lib/format-address.ts` with `formatAddress(json: string | null): string | null` — parses JSON, formats as Brazilian address, returns `null` on empty/corrupt input
- [x] 1.2 Re-export `formatAddress` from the module barrel (`src/modules/patients/index.ts`) if needed internally

## 2. Display fix

- [x] 2.1 Update `src/modules/patients/components/patient-overview-tab.tsx` line 183 to call `formatAddress(patient.address)` instead of passing the raw string
- [x] 2.2 Update `src/modules/patients/lib/generate-patient-pdf.ts` line 207 to call `formatAddress(input.address)` for the PDF export

## 3. Tests

- [ ] 3.1 Add unit tests for `formatAddress` covering: full address, partial fields, null, empty object, corrupt JSON
