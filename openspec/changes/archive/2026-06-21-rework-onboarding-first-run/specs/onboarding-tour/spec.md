## REMOVED Requirements

### Requirement: Guided tour presents five tooltips over the dashboard
**Reason**: The Driver.js guided tour proved to be of no value to onboarding psychologists and only added weight (a client bundle, a DB column, scattered DOM anchors). The entire capability is removed.
**Migration**: Delete the tour components (`dashboard-tour.tsx`, `dashboard-tour-impl.tsx`), the step catalog (`lib/tour-steps.ts`), and the `data-tour-anchor` attributes on the sidebar nav and dashboard sections. Remove the `driver.js` dependency. First-run guidance is now served by the onboarding wizard (forced before the dashboard) and the dashboard "Primeiros passos" checklist; no replacement tour is provided.

### Requirement: Tour runs automatically only once
**Reason**: The tour is removed, so there is no auto-run gate to maintain. The `profiles.tour_completed_at` column that backed the gate is dropped (see `onboarding-data-model`).
**Migration**: Delete the `completeTour` Server Action and its impl (`server/complete-tour.ts`) and remove its wiring from `dashboard/page.tsx` and `dashboard/actions.ts`. Drop the `tour_completed_at` column via a Drizzle migration and remove it from `getCurrentProfileEdge` and the `Profile` type. Remove the `tour_completed_at` stamping/reset logic from the e2e seeds.

### Requirement: Tour is non-blocking and pausable
**Reason**: The tour is removed; there is no tour instance to make non-blocking or pausable.
**Migration**: None — the behavior disappears with the component deletion. No interaction model remains to preserve.

### Requirement: Tour never references post-MVP features and can be replayed
**Reason**: The tour is removed, so there is nothing to keep MVP-only or to replay.
**Migration**: Remove the "Refazer tour" control (`ReplayTourButton`) and its usage from Configurações → Ajuda → Primeiros Passos, and delete the replay query-param/window-event mechanism. The remaining Ajuda → Primeiros Passos page content is preserved.
