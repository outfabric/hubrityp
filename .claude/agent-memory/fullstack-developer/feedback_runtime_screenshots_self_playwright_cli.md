---
name: runtime-screenshots-self-playwright-cli
description: For Figma-vs-runtime visual verification, I bring up the app and capture screenshots myself via the playwright-cli skill — do NOT delegate to the qa-tester agent
metadata:
  type: feedback
---

When verifying my own work against a Figma frame (capturing the rendered
app to compare against the Figma reference), **I do it myself**: bring the
app up (`docker compose up`) and capture the runtime screenshots using the
**playwright-cli** skill, which I have direct access to.

**Scope is narrow:** this self-capture rule applies **only** to the
Figma-vs-runtime visual self-verification of my own work. For **every other**
QA need (exploratory testing, manual QA, visual regressions, accessibility,
responsive/edge-case flows, pre-release checks) keep delegating to the
**qa-tester** agent — do not self-run playwright-cli for those.

**Why:** user explicitly instructed this (2026-06-23) while planning Homepage
Figma-correction tasks, then clarified the next day that it is scoped to this
case only — the screenshot capture here is part of *my* verification loop, but
the qa-tester agent remains the default for all other QA.

**How to apply:** for the runtime-capture step of the Figma compare loop
(see [[figma-sources]] for the canonical frames/node-ids), invoke the
playwright-cli skill directly — open the page at each Figma frame's real
width, screenshot + read `getComputedStyle`. Anything broader than "did my
change match its Figma frame" → route to qa-tester.
