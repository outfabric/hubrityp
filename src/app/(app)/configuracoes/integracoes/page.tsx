import Link from 'next/link';

import { INTEGRATIONS } from '@/app/(app)/configuracoes/integracoes/integrations';
import { clientEnv } from '@/shared/env/client';
import { Badge } from '@/shared/ui/badge';
import { Card } from '@/shared/ui/card';

/**
 * Integrations index page — renders a responsive grid of cards linking to each
 * integration. Server Component (no client JS needed). When the WhatsApp UI is
 * disabled, the WhatsApp card is rendered frozen: non-navigable, visually
 * muted, and tagged "Em breve". v1 ships with WhatsApp only.
 */
export default function IntegrationsIndexPage() {
  const whatsappUiEnabled = clientEnv.NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED;

  return (
    <div data-testid="integrations-index-page">
      <h1
        className="text-text-primary text-[28px] leading-[1.25] font-semibold"
        data-testid="integrations-index-page-title"
      >
        Integrações
      </h1>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS.map((integration) => {
          const Icon = integration.icon;
          const disabled = !whatsappUiEnabled && integration.slug === 'whatsapp';

          // Frozen card: non-navigable (`<Card>`, no `<Link>`), `aria-disabled`.
          // `text-disabled` is intentionally below 4.5:1 AA for normal text —
          // WCAG 1.4.3 exempts inactive UI components, which this is. The DS
          // token is authoritative; the "Em breve" neutral badge clears AA.
          if (disabled) {
            return (
              <Card
                key={integration.slug}
                aria-disabled="true"
                className="h-full cursor-not-allowed p-6"
                data-testid={`integration-card-${integration.slug}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <Icon size={20} className="text-text-disabled" aria-hidden="true" />
                  <Badge variant="neutral">Em breve</Badge>
                </div>

                <h3 className="text-text-disabled mt-3 text-[18px] leading-[1.25] font-semibold">
                  {integration.label}
                </h3>

                <p className="text-text-disabled mt-1 text-[13px] leading-[1.5] font-normal">
                  {integration.description}
                </p>
              </Card>
            );
          }

          return (
            <Link
              key={integration.slug}
              href={integration.href}
              className="focus-visible:shadow-focus rounded-xl focus-visible:outline-none"
            >
              <Card
                className="duration-fast hover:border-border-strong h-full cursor-pointer p-6 transition-colors"
                data-testid={`integration-card-${integration.slug}`}
              >
                <Icon size={20} className="text-text-secondary" aria-hidden="true" />

                <h3 className="text-text-primary mt-3 text-[18px] leading-[1.25] font-semibold">
                  {integration.label}
                </h3>

                <p className="text-text-secondary mt-1 text-[13px] leading-[1.5] font-normal">
                  {integration.description}
                </p>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
