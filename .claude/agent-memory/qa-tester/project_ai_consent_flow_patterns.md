---
name: ai-consent-flow-patterns
description: AI transcription consent flow UI patterns — states, token format, expiry logic, and known issues found in QA
metadata:
  type: project
---

The AI transcription consent feature uses a 4-state model: none, pending, active, revoked. The AiConsentPanel lives at the patient detail page (`/pacientes/[id]`) rendered via `@/modules/patients/components/ai-consent-panel.tsx`. Each state has distinct badge, body copy, and primary action.

Token format: 43-char base64url (32 bytes). Distinguished from general consent's 64-char hex token in the `/termo/[token]` page.tsx dispatcher. Expiry is computed as `created_at + 7 days` (no explicit `expires_at` column).

**Known inconsistency found:** `getAiConsentStatusImpl` treats expired unsigned terms as 'none' (allowing "Gerar termo" button), but `generateAiConsentTermImpl` blocks generation with ALREADY_ACTIVE because its existing-term check uses only `isNull(revokedAt)` without filtering expired terms. This creates a dead-end state.

**Why:** This matters for the re-generation workflow when a patient ignores the first consent link.

**How to apply:** When testing consent term generation after expiry, verify that the generate action and status query have consistent expiry logic. Also check the pending state layout on mobile (buttons overflow at 375px).
