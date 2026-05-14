import Link from 'next/link';

import { SETTINGS_AREAS } from '@/app/(app)/configuracoes/settings-areas';
import { Card } from '@/shared/ui/card';

/**
 * Settings index page — renders a responsive grid of interactive cards
 * linking to each settings area. Server Component (no client JS needed).
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
