'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { BREADCRUMB_LABELS } from '@/app/(app)/configuracoes/breadcrumb-labels';

/**
 * Breadcrumb navigation for the settings section. Reads the current pathname,
 * splits it from the `configuracoes` segment onward, and maps each segment to
 * a human-readable label via `BREADCRUMB_LABELS`. Dynamic segments (e.g.
 * `[templateKey]`) fall through to the raw segment value.
 *
 * On the index page (`/configuracoes`), only "Configuracoes" is shown as the
 * current (non-linked) segment. On sub-routes, intermediate segments are
 * linked and the last segment is the non-linked current page.
 */
export function SettingsBreadcrumb() {
  const pathname = usePathname();

  const allSegments = pathname.split('/').filter(Boolean);
  const configIndex = allSegments.indexOf('configuracoes');

  // Should never happen under the configuracoes layout, but guard anyway.
  if (configIndex === -1) return null;

  const segments = allSegments.slice(configIndex);

  return (
    <nav aria-label="Breadcrumb" data-testid="settings-breadcrumb">
      <ol className="flex items-center gap-1">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          const label = BREADCRUMB_LABELS[segment] ?? segment;
          const href = '/' + segments.slice(0, index + 1).join('/');

          return (
            <li key={href} className="flex items-center gap-1">
              {index > 0 && (
                <ChevronRight size={12} className="text-text-tertiary" aria-hidden="true" />
              )}

              {isLast ? (
                <span
                  className="text-text-primary text-[13px] leading-[1.5] font-medium"
                  aria-current="page"
                >
                  {label}
                </span>
              ) : (
                <Link
                  href={href}
                  className="text-text-tertiary hover:text-text-primary duration-fast text-[13px] leading-[1.5] transition-colors"
                >
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
