---
name: app-mobile-sidebar-overflow
description: App shell navigation sidebar does not collapse on mobile viewports causing horizontal overflow on all authenticated pages
metadata:
  type: project
---

The app shell's sidebar navigation (239px wide) is displayed at all viewport sizes including mobile (375px). This causes a horizontal overflow (scrollWidth 671px vs 375px viewport) on every authenticated page. The sidebar should collapse behind a hamburger menu on mobile.

**Why:** Pre-existing layout issue in the app shell, not specific to any single feature. Affects all pages under the `(app)` route group.

**How to apply:** When testing any feature on mobile, account for this overflow — it will clip content on the right side. Do not report it as a new bug per feature; reference this memory instead. Track separately as a cross-cutting layout issue.
