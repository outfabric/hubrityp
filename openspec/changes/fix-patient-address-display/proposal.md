## Why

The patient detail page ("Visão geral" tab) renders the address field as a raw JSON string (e.g., `{"street":"Rua Exemplo","number":"123",...}`) instead of a human-readable formatted address. The address is stored as `JSON.stringify(obj)` in a Postgres `text` column, and the overview tab passes it directly to `<DataField>` without parsing or formatting.

## What Changes

- Add a `formatAddress` helper that parses the JSON address string and returns a formatted Brazilian address (e.g., "Rua Exemplo, 123 - Centro - São Paulo, SP 01001-000").
- Update `PatientOverviewTab` to use `formatAddress` instead of rendering the raw string.
- Update `generatePatientPdf` to use the same formatter for consistent address display in PDF exports.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `patient-detail`: The "Visão geral" tab SHALL display the address as a formatted human-readable string instead of the raw JSON storage representation.

## Impact

- `src/modules/patients/components/patient-overview-tab.tsx` — rendering change
- `src/modules/patients/lib/` — new `format-address.ts` helper
- `src/modules/patients/lib/generate-patient-pdf.ts` — use formatter for PDF export
