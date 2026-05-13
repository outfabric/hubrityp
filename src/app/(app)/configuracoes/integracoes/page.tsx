import Link from 'next/link';

import { INTEGRATIONS } from '@/app/(app)/configuracoes/integracoes/integrations';
import { Card } from '@/shared/ui/card';

/**
 * Integrations index page — renders a responsive grid of interactive cards
 * linking to each integration. Server Component (no client JS needed).
 * v1 ships with WhatsApp only; grid is prepared to scale.
 */
export default function IntegrationsIndexPage() {
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
