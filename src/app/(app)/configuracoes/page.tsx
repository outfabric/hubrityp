import Link from 'next/link';

import { SETTINGS_AREAS } from '@/app/(app)/configuracoes/settings-areas';
import { clientEnv } from '@/shared/env/client';
import { Badge } from '@/shared/ui/badge';
import { Card } from '@/shared/ui/card';

/**
 * Decides whether a settings-area card is frozen ("Em breve"), gated per
 * surface by an independent WhatsApp UI feature flag:
 *
 * - `lembretes` — the reminder settings screen, governed by the REMINDERS flag
 *   (ON in the shared-number reminders MVP, so this card is navigable).
 * - `whatsapp` — the connection surface (connect number + template text),
 *   governed by the CONNECTION flag (OFF in the MVP, so this card is frozen).
 *
 * Every other area is always navigable — the WhatsApp flags never touch it.
 */
function isAreaFrozen(slug: string): boolean {
  if (slug === 'lembretes') {
    return !clientEnv.NEXT_PUBLIC_WHATSAPP_REMINDERS_UI_ENABLED;
  }
  if (slug === 'whatsapp') {
    return !clientEnv.NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED;
  }
  return false;
}

/**
 * Settings index page — renders a responsive grid of cards linking to each
 * settings area. Server Component (no client JS needed). Each WhatsApp-
 * dependent card is frozen independently by its own surface flag (see
 * `isAreaFrozen`): a frozen card is rendered non-navigable, visually muted, and
 * tagged "Em breve". The flags are UI-only — the underlying routes stay
 * reachable by direct URL (auth gating is the middleware's job, not the flag's).
 */
export default function SettingsIndexPage() {
  return (
    <div data-testid="settings-index-page">
      <h1
        className="text-text-primary text-[28px] leading-[1.25] font-semibold"
        data-testid="settings-index-page-title"
      >
        Configurações
      </h1>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {SETTINGS_AREAS.map((area) => {
          const Icon = area.icon;
          const disabled = isAreaFrozen(area.slug);

          // Frozen card: non-navigable (`<Card>`, no `<Link>`), `aria-disabled`.
          // `text-disabled` is intentionally below 4.5:1 AA for normal text —
          // WCAG 1.4.3 exempts inactive UI components, which this is. The DS
          // token is authoritative; the "Em breve" neutral badge clears AA.
          if (disabled) {
            return (
              <Card
                key={area.slug}
                aria-disabled="true"
                className="h-full cursor-not-allowed p-6"
                data-testid={`settings-area-card-${area.slug}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <Icon size={20} className="text-text-disabled" aria-hidden="true" />
                  <Badge variant="neutral">Em breve</Badge>
                </div>

                <h3 className="text-text-disabled mt-3 text-[18px] leading-[1.25] font-semibold">
                  {area.label}
                </h3>

                <p className="text-text-disabled mt-1 text-[13px] leading-[1.5] font-normal">
                  {area.description}
                </p>
              </Card>
            );
          }

          return (
            <Link
              key={area.slug}
              href={area.href}
              className="focus-visible:shadow-focus rounded-xl focus-visible:outline-none"
            >
              <Card
                className="duration-fast hover:border-border-strong h-full cursor-pointer p-6 transition-colors"
                data-testid={`settings-area-card-${area.slug}`}
              >
                <Icon size={20} className="text-text-secondary" aria-hidden="true" />

                <h3 className="text-text-primary mt-3 text-[18px] leading-[1.25] font-semibold">
                  {area.label}
                </h3>

                <p className="text-text-secondary mt-1 text-[13px] leading-[1.5] font-normal">
                  {area.description}
                </p>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
