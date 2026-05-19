---
name: clinical-documents-module-patterns
description: Architecture patterns from the prontuario-formal-documents change -- RLS finalized-row guard, Inngest PDF job, dangerouslySetInnerHTML risk, negative-auth E2E gap
metadata:
  type: project
---

The medical-records module added formal clinical document support (declaracao, atestado, relatorio, laudo, parecer per CFP 06/2019) with these patterns:

**RLS finalized-row immutability pattern:** The `clinical_documents` UPDATE policy uses `USING (auth.uid() = user_id AND status = 'draft')`. Once finalized, the USING clause evaluates false and no authenticated UPDATE can succeed. The Inngest service-role client (db owner connection) bypasses this to write `pdf_storage_path` after PDF generation — this is the justified service-role bypass. Future tables with similar lifecycle states should replicate this pattern.

**Drizzle db client bypasses RLS:** The `db` object from `@/shared/db/client` uses `DATABASE_URL` (Postgres owner role) and does NOT set `auth.uid()`. Every query in Server Action `Impl` functions that touches user-scoped tables MUST include `eq(table.userId, userId)` where `userId` derives from `supabase.auth.getUser()`. RLS is a second layer, not the only layer. This was flagged as a latent footgun in review-1 — future reviewers should auto-flag any new `db.select().from(userTable)` without an explicit userId filter.

**dangerouslySetInnerHTML with Tiptap content:** `document-viewer.tsx` uses `dangerouslySetInnerHTML={{ __html: value }}` on content stored in JSONB. The "Tiptap sanitizes at authoring time" argument does not hold for content that passes through SQL or bulk-import paths. Flagged HIGH in review-1. DOMPurify (browser-only `dompurify` package) was added in the fix commit (review-2) but had an SSR gap: `DOMPurify.isSupported` is false in Node.js, so `sanitize()` returns the raw string unchanged during SSR. Resolved in review-3 (iteration 3) by replacing with `isomorphic-dompurify@3.13.0` (which ships a jsdom shim for Node.js). Auto-flag `import DOMPurify from 'dompurify'` (not isomorphic) in any component that is SSR'd. Pre-existing gap in `treatment-plan/version-history-sheet.tsx:L192,L203` — no DOMPurify at all there (predates this branch, needs follow-up ticket). When reviewing any component with `dangerouslySetInnerHTML` on a string from DB/props, demand isomorphic-dompurify or ssr:false.

**Negative-auth E2E test pattern:** The project mandates a Playwright test WITHOUT `storageState` for every new gated route group. The canonical pattern (seen in both `treatment-plan.spec.ts:L276` and now `clinical-documents.spec.ts:L546`): import `test as baseTest` from `@playwright/test` (NOT from `db-fixture`), use `baseTest.describe('@prontuario <feature> negative-auth', ...)` with no `.use({ storageState })`, `page.goto(targetPath)`, `page.waitForURL('**/login**')`, assert `redirectTo` param truthy. `baseTest` is anonymous because the seeded playwright config sets no global storageState. Clinical-documents spec was missing this in review-1, added in review-3 iteration. Auto-flag any E2E spec covering a gated route that lacks a matching negative-auth block — this is a recurring pattern miss in this codebase (two occurrences now).

**Inngest PDF job pattern:** 5-step function: read-document (idempotency check on pdfStoragePath) → build-pdf (pure, buffer to base64 for step serialization) → upload-to-storage (service-role supabase client) → update-document-row (service-role db, bypasses finalized RLS) → write-audit-log. Service-role client created lazily inside the step (not at module level) via `createClient(url, serviceRoleKey)`. This is the pattern for future background jobs that need to update finalized rows.

**CID-10 consent gate:** The gate is evaluated SERVER-SIDE in `finalizeDocumentImpl` by calling `computeReferencesCid10(document.content)` on the DB row — not on client input. The UI checkbox is a UX helper, not the gate. The server rejects if `referencesCid10=true` and `cid10ConsentConfirmed !== true`. This is correct LGPD Art. 11 implementation.

**Why:** Documents patterns for future reviews of the clinical-documents and related medical-records module features.
**How to apply:** When reviewing future changes to clinical_documents (e.g., digital signature, document export, bulk generation): verify RLS policy still has the `status='draft'` guard; verify any new `db` queries have explicit userId filters; demand DOMPurify on any new `dangerouslySetInnerHTML`; require negative-auth E2E test on any new sub-route.
