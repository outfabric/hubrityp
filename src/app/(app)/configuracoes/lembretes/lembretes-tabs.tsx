'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { clientEnv } from '@/shared/env/client';

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

interface TabDefinition {
  label: string;
  href: string;
  slug: string;
  /** When true, the tab is active if the pathname starts with href (prefix match).
   *  When false, only an exact match activates the tab. */
  prefixMatch: boolean;
}

const TABS: TabDefinition[] = [
  {
    label: 'Configuração',
    href: '/configuracoes/lembretes',
    slug: 'configuracao',
    prefixMatch: false,
  },
  {
    label: 'Templates',
    href: '/configuracoes/lembretes/templates',
    slug: 'templates',
    prefixMatch: true,
  },
  {
    label: 'Histórico',
    href: '/configuracoes/lembretes/historico',
    slug: 'historico',
    prefixMatch: false,
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Underline-style tab navigation for the Lembretes settings section.
 *
 * Uses `<Link>` elements (not state-controlled tabs) so that deep-linking,
 * browser refresh, and back/forward navigation work natively. The active tab
 * is determined by matching `usePathname()` against each tab's href.
 */
export function LembretesTabs() {
  const pathname = usePathname();

  // The "Templates" tab edits the platform-managed WhatsApp templates, which
  // are frozen during the shared-number reminders MVP. It is fully hidden
  // (not disabled / "Em breve") while the connection UI flag is off. The
  // underlying `/configuracoes/lembretes/templates*` routes stay reachable by
  // direct URL — this is visual-only gating.
  const visibleTabs = TABS.filter(
    (tab) => tab.slug !== 'templates' || clientEnv.NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED,
  );

  return (
    <nav
      data-testid="lembretes-tabs"
      className="overflow-x-auto [-webkit-overflow-scrolling:touch]"
    >
      <div className="flex">
        {visibleTabs.map((tab) => {
          const isActive = tab.prefixMatch ? pathname.startsWith(tab.href) : pathname === tab.href;

          return (
            <Link
              key={tab.slug}
              href={tab.href}
              data-testid={`lembretes-tab-${tab.slug}`}
              className={[
                'inline-flex min-h-[44px] items-center px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors',
                'focus-visible:shadow-focus focus-visible:outline-none',
                isActive
                  ? 'text-text-primary border-brand-500 border-b-2'
                  : 'text-text-secondary hover:text-text-primary',
              ].join(' ')}
              aria-current={isActive ? 'page' : undefined}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
