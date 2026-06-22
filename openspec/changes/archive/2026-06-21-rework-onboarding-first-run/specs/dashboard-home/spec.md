## REMOVED Requirements

### Requirement: First authenticated dashboard render stamps first_access_at
**Reason**: After this change, an active psychologist with incomplete onboarding is redirected to the onboarding wizard before reaching the dashboard (see `middleware-gating`). The dashboard is therefore no longer the first authenticated destination, so stamping `first_access_at` here would record the wrong moment for the day-7 NPS anchor. The dashboard no longer renders the guided tour either (the `onboarding-tour` capability is removed), so the dashboard's first-run responsibilities are reduced to its operational sections.

**Migration**: The `first_access_at` stamp moves to the onboarding wizard's first authenticated render — see `onboarding-wizard` → "Wizard entry stamps first_access_at". The write remains session-scoped (`auth.uid()`), idempotent (`first_access_at IS NULL`), and fire-and-forget. No schema change; only the stamping location moves. The dashboard `page.tsx` removes its `stampFirstAccess` call and the `<DashboardTour>` render.
