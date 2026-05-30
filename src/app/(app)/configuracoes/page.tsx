import Link from 'next/link';

import { SETTINGS_AREAS } from '@/app/(app)/configuracoes/settings-areas';
import { clientEnv } from '@/shared/env/client';
import { Badge } from '@/shared/ui/badge';
import { Card } from '@/shared/ui/card';

/**
 * Slugs whose cards are frozen ("Em breve") while the WhatsApp UI is disabled.
 * Both depend on the WhatsApp integration, so they share the same flag.
 */
const WHATSAPP_DEPENDENT_SLUGS = new Set(['whatsapp', 'lembretes']);

/**
 * Settings index page — renders a responsive grid of cards linking to each
 * settings area. Server Component (no client JS needed). When the WhatsApp UI
 * is disabled, the WhatsApp- and reminder-dependent cards are rendered frozen:
 * non-navigable, visually muted, and tagged "Em breve".
 */
export default function SettingsIndexPage() {
  const whatsappUiEnabled = clientEnv.NEXT_PUBLIC_WHATSAPP_UI_ENABLED;

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
          const disabled = !whatsappUiEnabled && WHATSAPP_DEPENDENT_SLUGS.has(area.slug);

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
