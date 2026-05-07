---
name: PII in log payloads is a BLOCKER
description: Email addresses and other PII must never appear in structured logger payloads - use hashed/truncated SHA-256 instead
type: feedback
---

Email addresses logged in `send-account-locked.ts` and `send-password-changed.ts` logger payloads were flagged as a BLOCKER in review-1 of auth-login-hardening-and-recovery (2026-05-05).

**Why:** LGPD classifies email as personal data. The project's own `request-password-reset.ts` already demonstrates the correct pattern: `hashEmail()` producing a 16-char truncated SHA-256 prefix for correlation without PII exposure.

**How to apply:** Any log line that includes user-identifiable data (email, name, phone, CRP) should be flagged as BLOCKER. UUIDs (user_id) are acceptable. The `hashEmail` pattern from `modules/password-recovery/server/request-password-reset.ts` is the canonical example to reference.
