---
name: format-address-qa
description: formatAddress helper QA — where it renders, format rules, defensive edge-case behavior, and how to test empty/corrupt cases
metadata:
  type: project
---

`patients.address` is a `text` column storing a JSON-serialized object (`{street,number,complement,neighborhood,city,state,zipCode}`). `formatAddress(json: string|null)` (`src/modules/patients/lib/format-address.ts`) parses it into a pt-BR string.

**Where rendered (both share the same helper — verify together):**
- Overview tab: `patient-overview-tab.tsx`, `DataField` testid `patient-field-address`; `value || '-'` so null → `-`.
- PDF export: `generate-patient-pdf.ts` — when `formatAddress` returns null the Endereço line is **omitted entirely** (no `-`, no raw JSON). LGPD-safe.

**Format:** `street, number, complement - neighborhood - city, state zipCode`. Group separators collapse — missing parts never leave dangling `,`/`-`.

**Defensive behavior (all confirmed, no crash):** non-string field values (numbers) are dropped (`cleanPart` requires typeof string); whitespace-only trimmed→dropped; `{}`/null/invalid-JSON/array/bare-string/number → null → `-`. React escapes HTML in values (XSS safe).

**Why:** original bug rendered raw JSON verbatim in the overview tab.

**How to apply:** For empty/corrupt-address scenarios the form won't produce them — insert directly via DB (`docker exec supabase_db_hubrityp psql -U postgres -d postgres`, pass UTF-8 SQL via `-i < file` not heredoc-through-exec). To verify PDF text use `pdftotext -layout file.pdf -` (PDFKit subsets fonts so raw-stream grep / zlib extraction returns nothing). See [[authenticated-browser-qa-setup]].
