---
name: sp-week-window-half-day-fudge
description: Computing SP-local week/day boundaries by subtracting (N days + MS/2) overshoots backward and lands on the wrong weekday; snap via a noon-anchored day shift instead
metadata:
  type: feedback
---

When building `America/Sao_Paulo` calendar-window helpers (start-of-day, start-of-week Monday, start-of-month) for owner-scoped dashboard/agenda aggregates, do NOT compute the Monday by `dayStart - (isoDow-1)*MS - MS/2` then snapping. The extra `- MS/2` overshoots when going *backward*, pushing the result onto Sunday (off-by-one weekday), and a downstream `nextWeek` built on top then collapses to the same instant — every weekly count comes back 0.

**Why:** the half-day fudge is only safe when you are *inside* the target day and snapping to its midnight. Subtracting it shifts you out of the target day in the backward direction.

**How to apply:** use a single primitive — `startOfSaoPauloDayShifted(now, days)` = `startOfSaoPauloDay(now)`, add `days*MS + MS/2` (noon of the *shifted* day), then `startOfSaoPauloDay(...)` to snap. This anchors at noon of the correct calendar day before snapping, so it works for both negative (week start) and positive (next day/week) offsets and survives a hypothetical DST return. Verify boundaries with a throwaway node script that prints `formatInTimeZone(ws, TZ, 'EEEE')` — weekStart MUST print "Monday" and weekEnd the following "Monday". Brazil has no DST today, but the noon anchor keeps it robust. See `src/modules/dashboard/lib/sao-paulo-windows.ts`.
