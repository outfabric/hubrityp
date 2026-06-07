---
name: whatsapp-ui-freeze-flag
description: NEXT_PUBLIC_WHATSAPP_UI_ENABLED freezes WhatsApp UI entry points (inbox sidebar item, WhatsApp+Lembretes settings cards) without gating the routes
metadata:
  type: project
---

`NEXT_PUBLIC_WHATSAPP_UI_ENABLED` (default OFF, set `'false'` in docker-compose) freezes the WhatsApp UI entry points until the feature ships.

**Why:** WhatsApp/reminders aren't ready for users yet, but the code is in the tree; the flag hides the entry points without ripping out routes/modules.

**How it manifests when OFF (verified live 2026-05-30, QA-1 all PASS):**
- Sidebar `src/app/(app)/sidebar-nav.tsx`: "Caixa de entrada" renders as a non-navigable `<span>` (no `<Link>`/href), `aria-disabled="true"`, `tabIndex=-1` (keyboard-unreachable), `cursor: not-allowed`, neutral "Em breve" Badge. The unread-count danger badge is STRUCTURALLY suppressed (disabled branch returns before the `showBadge` logic) — count cannot leak.
- `src/app/(app)/configuracoes/page.tsx` (+ `settings-areas.ts`): "WhatsApp" and "Lembretes" cards frozen as aria-disabled spans w/ "Em breve", opacity 0.6; "Locais de atendimento", "Agenda", "Transcrição IA" stay real links.
- `src/app/(app)/configuracoes/integracoes/page.tsx` (+ `integrations.ts`): "WhatsApp" integration card frozen.
- Route `/caixa-de-entrada` is NOT gated — direct URL still returns 200 and renders the inbox empty state. Asserted by `__tests__/unit/middleware/whatsapp-ui-flag-no-route-gating.test.ts`. The flag freezes UI entry points only.

**How to apply (QA):** flag is build-time inlined (`NEXT_PUBLIC_*`), so flipping it to test the un-frozen path needs a `.next` rebuild, not just a restart. To test frozen path, just confirm: disabled spans, aria-disabled, no href, Em breve badge, no unread badge, click ⇒ URL unchanged, working cards navigate, /caixa-de-entrada direct ⇒ 200. App has NO dark mode (no next-themes/.dark) — dark-mode checks are N/A.

Related: [[authenticated-browser-qa-setup]], [[playwright-cli-invocation]].
