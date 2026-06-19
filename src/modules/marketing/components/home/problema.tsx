// Problema — the "mirror" section of the public homepage (`/`).
// --------------------------------------------------------------------------
// Presentational Server Component (no client hooks, no PII, no secrets). It
// mirrors the prospect's current reality with the title "Você ainda faz isso?",
// the five fragmented-workflow items from the content layer, and a recognition
// (not judgment) closing line.
//
// Spec guard: exactly 5 mirror items + the recognition closer come from
// `PROBLEM` in `home-content.ts`; `prova-problema.test.tsx` asserts the count
// and the closer wording. No emojis in the UI (DS rule) — each item gets a
// neutral Lucide chevron marker.

import { ChevronRight } from 'lucide-react';
import * as React from 'react';

import { Container } from '@/modules/marketing/components/container';
import { PROBLEM } from '@/modules/marketing/lib/home-content';

/**
 * The homepage "mirror" section. Lists the five fragmented-tool habits and
 * closes with a line of recognition. Purely presentational — no interactivity.
 */
export function Problema(): React.JSX.Element {
  return (
    <section aria-labelledby="problema-title" className="py-16 md:py-24">
      <Container className="flex flex-col items-center gap-10 text-center">
        <h2 id="problema-title" className="text-display-md text-text-primary text-balance">
          {PROBLEM.title}
        </h2>

        <ul className="flex w-full max-w-2xl flex-col gap-4 text-left">
          {PROBLEM.items.map((item) => (
            <li
              key={item}
              className="bg-surface border-border flex items-start gap-3 rounded-lg border px-4 py-3"
            >
              <ChevronRight
                aria-hidden="true"
                className="text-text-tertiary mt-0.5 size-5 shrink-0"
              />
              <span className="text-text-secondary text-pretty">{item}</span>
            </li>
          ))}
        </ul>

        <p className="text-lead text-text-primary max-w-2xl font-medium text-pretty">
          {PROBLEM.closer}
        </p>
      </Container>
    </section>
  );
}

Problema.displayName = 'Problema';
