'use client';

// Funcionalidades — the MVP feature grid of the public homepage (`/`).
// --------------------------------------------------------------------------
// Renders the seven MVP feature cards from the content layer (`FEATURE_CARDS`)
// as a 3×2 grid with the Dashboard card spanning the full width on the last row
// (double-width). Each card has a Lucide icon, an `<h3>` title (`Heading/h3`),
// a benefit-focused description, and a clickable screenshot thumbnail that opens
// the same screenshot full-size in an accessible lightbox.
//
// Section id is `funcionalidades` so the hero's "Ver funcionalidades" CTA can
// anchor to it.
//
// This is a Client Component because each thumbnail is an interactive trigger
// that opens a modal and the open/close state lives here. It is a presentational
// leaf nonetheless: no PII, no secrets — only the static content + screenshot
// assets owned by `home-content.ts`. Screenshot sources come from `SCREENSHOTS`
// (a closed, build-time map), never from user input, so there is no URL sink.

import {
  Calendar,
  FileText,
  LayoutDashboard,
  MessageCircle,
  Sparkles,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

import { Container } from '@/modules/marketing/components/container';
import { ScreenshotLightbox } from '@/modules/marketing/components/home/screenshot-lightbox';
import {
  FEATURE_CARDS,
  SCREENSHOTS,
  type LucideIconName,
  type ScreenshotKey,
} from '@/modules/marketing/lib/home-content';
import { cn } from '@/shared/lib/utils';

/**
 * Static name → component map for the icons the feature cards reference. Kept
 * explicit (not a dynamic import) because the set is small and known at build
 * time; statically importing keeps the icons in this chunk with no loading
 * state. There is no user input here, so the map cannot be abused.
 */
const CARD_ICONS = {
  Calendar,
  Users,
  MessageCircle,
  FileText,
  Video,
  Sparkles,
  LayoutDashboard,
} satisfies Record<LucideIconName, LucideIcon>;

function resolveIcon(name: LucideIconName): LucideIcon {
  // Fall back to LayoutDashboard so an unmapped icon name can never crash the
  // page; the unit test pins the content layer to the mapped names.
  return CARD_ICONS[name as keyof typeof CARD_ICONS] ?? LayoutDashboard;
}

/**
 * The homepage feature grid: seven MVP cards, the Dashboard card double-width.
 * Clicking a card's thumbnail opens that screenshot in an accessible lightbox.
 */
export function Funcionalidades(): React.JSX.Element {
  // Single shared lightbox: only one screenshot is open at a time, so we track
  // the active screenshot key (or null when closed). Keeping the key — not the
  // resolved asset — keeps the open state minimal and serializable.
  const [activeScreenshot, setActiveScreenshot] = React.useState<ScreenshotKey | null>(null);

  const close = React.useCallback(() => setActiveScreenshot(null), []);

  const activeAsset = activeScreenshot !== null ? SCREENSHOTS[activeScreenshot] : null;

  return (
    <section
      id="funcionalidades"
      aria-labelledby="funcionalidades-title"
      className="py-16 md:py-24"
    >
      <Container className="flex flex-col items-center gap-10">
        <h2
          id="funcionalidades-title"
          className="text-display-md text-text-primary text-center text-balance"
        >
          Tudo o que você precisa, em um só sistema
        </h2>

        <ul className="grid w-full max-w-5xl grid-cols-1 gap-6 md:grid-cols-3">
          {FEATURE_CARDS.map((card) => {
            const Icon = resolveIcon(card.icon);
            const asset = card.screenshot !== undefined ? SCREENSHOTS[card.screenshot] : null;
            const screenshotKey = card.screenshot;

            return (
              <li
                key={card.id}
                className={cn(
                  'bg-surface border-border flex flex-col gap-4 rounded-xl border p-6',
                  card.wide ? 'md:col-span-3' : undefined,
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="bg-brand-50 text-brand-700 inline-flex size-11 shrink-0 items-center justify-center rounded-full">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <h3 className="text-text-primary text-lg font-semibold text-balance">
                    {card.title}
                  </h3>
                </div>

                <p className="text-text-secondary text-pretty">{card.description}</p>

                {asset !== null && screenshotKey !== undefined ? (
                  <button
                    type="button"
                    onClick={() => setActiveScreenshot(screenshotKey)}
                    aria-haspopup="dialog"
                    aria-label={`Ampliar captura de tela: ${card.title}`}
                    className={cn(
                      'border-border-subtle bg-surface-muted group mt-auto overflow-hidden rounded-lg border',
                      'focus-visible:shadow-focus cursor-pointer outline-none',
                    )}
                  >
                    <Image
                      src={asset.src}
                      alt={asset.alt}
                      width={asset.width}
                      height={asset.height}
                      loading="lazy"
                      sizes={
                        card.wide
                          ? '(max-width: 768px) 100vw, 960px'
                          : '(max-width: 768px) 100vw, 360px'
                      }
                      className="h-auto w-full transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Container>

      {/* Single shared lightbox instance. Rendered only when a thumbnail is
          active; it traps focus and restores it to the triggering thumbnail on
          close. */}
      {activeAsset !== null ? (
        <ScreenshotLightbox open onClose={close} screenshot={activeAsset} />
      ) : null}
    </section>
  );
}

Funcionalidades.displayName = 'Funcionalidades';
