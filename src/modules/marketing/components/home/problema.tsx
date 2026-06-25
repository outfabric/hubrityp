// Problema — the "mirror" section of the public homepage (`/`).
// --------------------------------------------------------------------------
// Presentational Server Component (no client hooks, no PII, no secrets). It
// mirrors the prospect's current reality with the title "Você ainda faz isso?"
// (`Display/lg`), exactly five fragmented-workflow items — each an icon chip
// (40×40 desktop / 36×36 mobile, `surface-sunken` with a `brand` accent icon)
// followed by a one-line label — and a recognition (not judgment) closing line.
//
// Each item's label is [[ResponsiveCopy]]: both the desktop (Figma `114:2`) and
// the condensed mobile (`135:9`) string are rendered, toggled by Tailwind
// (`hidden md:inline` / `md:hidden`). The hidden variant is marked `aria-hidden`
// so assistive tech reads each label exactly once.
//
// Spec guard: exactly 5 mirror items + the recognition closer come from
// `PROBLEM` in `home-content.ts`; `prova-problema.test.tsx` asserts the count,
// both copy variants and the closer wording. No emojis in the UI (DS rule) —
// each item gets a neutral Lucide icon mapped from the content layer.

import { Calendar, FileText, MessageCircle, Table, Video, type LucideIcon } from 'lucide-react';
import * as React from 'react';

import { Container } from '@/modules/marketing/components/container';
import { PROBLEM, type LucideIconName } from '@/modules/marketing/lib/home-content';

/**
 * Static name → component map for the icons the mirror items reference. Kept
 * explicit (not a dynamic import) because the set is small and known at build
 * time; there is no user input here, so the map cannot be abused.
 */
const ITEM_ICONS = {
  MessageCircle,
  FileText,
  Calendar,
  Video,
  Table,
} satisfies Record<LucideIconName, LucideIcon>;

function resolveIcon(name: LucideIconName): LucideIcon {
  // Fall back to FileText so an unmapped icon name can never crash the page; the
  // unit test pins the content layer to the mapped names.
  return ITEM_ICONS[name as keyof typeof ITEM_ICONS] ?? FileText;
}

/**
 * The homepage "mirror" section. Lists the five fragmented-tool habits — each as
 * an icon chip plus a one-line label — and closes with a line of recognition.
 * Purely presentational — no interactivity.
 */
export function Problema(): React.JSX.Element {
  return (
    <section aria-labelledby="problema-title" className="py-16 md:py-24">
      <Container className="flex flex-col items-center gap-10 text-center">
        <h2 id="problema-title" className="text-display-lg text-text-primary text-balance">
          {PROBLEM.title}
        </h2>

        <ul className="flex w-full max-w-2xl flex-col gap-4 text-left">
          {PROBLEM.items.map((item) => {
            const Icon = resolveIcon(item.icon);

            return (
              <li
                key={item.label.desktop}
                className="bg-surface border-border flex items-center gap-3 rounded-xl border px-4 py-3"
              >
                {/* Icon chip: 36×36 mobile / 40×40 desktop, surface-sunken with a
                    brand-toned icon. */}
                <span className="bg-surface-sunken text-brand-700 inline-flex size-9 shrink-0 items-center justify-center rounded-xl md:size-10">
                  <Icon aria-hidden="true" className="size-5" />
                </span>

                {/* One-line label: desktop string from `md` up, condensed mobile
                    string below it (the hidden variant is `aria-hidden`). */}
                <span className="text-text-secondary">
                  <span className="hidden md:inline">{item.label.desktop}</span>
                  <span className="md:hidden" aria-hidden="true">
                    {item.label.mobile}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        <p className="text-lead text-text-primary max-w-2xl font-medium text-pretty">
          {PROBLEM.closer}
        </p>
      </Container>
    </section>
  );
}

Problema.displayName = 'Problema';
