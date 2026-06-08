## Context

The `address` column in the `patients` table is a `text` field that stores a `JSON.stringify`'d object with keys: `street`, `number`, `complement`, `neighborhood`, `city`, `state`, `zipCode` (all optional strings). The edit form (`patient-form.tsx`) already parses this JSON correctly. The display side (`patient-overview-tab.tsx` line 183 and `generate-patient-pdf.ts` line 207) renders the raw JSON string.

## Goals / Non-Goals

**Goals:**
- Display the address as a formatted Brazilian address string in the overview tab and PDF export.
- Handle missing/partial fields gracefully (all subfields are optional).

**Non-Goals:**
- Changing the storage format (the `text` column with JSON is fine for now).
- Adding address validation or autocomplete (CEP lookup, etc.).
- Modifying the address input form.

## Decisions

### 1. Single `formatAddress(json: string | null): string | null` helper

Place in `src/modules/patients/lib/format-address.ts`. Takes the raw JSON string from the DB, returns a formatted string or `null` if empty/unparseable. Both the overview tab and PDF generator call this one function.

**Why a shared helper instead of inline logic:** The same formatting is needed in two places (overview tab, PDF export), and future consumers (e.g., appointment confirmation messages) will need it too. A single helper ensures consistency.

### 2. Brazilian address format

```
Rua Exemplo, 123, Apto 4 - Centro - São Paulo, SP 01001-000
└── street ──┘  └#┘  └compl┘  └neighborhood┘  └city┘ └st┘ └zip┘
```

Rules:
- Start with `street`. Append `, number` if present. Append `, complement` if present.
- Separator ` - ` before `neighborhood` if present.
- Separator ` - ` before `city`. Append `, state` after city if present.
- Append ` zipCode` after state/city if present.
- Skip missing parts; collapse separators so there are no dangling commas or dashes.
- Return `null` if every field is absent or the JSON is unparseable.

### 3. Fail-safe parsing

If `JSON.parse` throws (corrupted data), return `null` — the `DataField` component already renders `'-'` for null values. No error toast needed; this is a display-only read path.

## Risks / Trade-offs

- **[Edge case: non-JSON legacy data]** → The helper wraps parsing in try/catch and returns `null`. If the raw string is a plain-text address from a hypothetical legacy import, it won't display — acceptable since no such data exists today.
