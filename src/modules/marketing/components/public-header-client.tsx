'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Logo } from '@/shared/ui/logo';

import { Container } from './container';
import { SignupCta } from './signup-cta';
import { ThemeToggle } from './theme-toggle';

/**
 * PublicHeaderClient — the interactive sticky marketing header (leaf).
 *
 * Receives a single server-derived boolean `isAuthenticated` (resolved via
 * `supabase.auth.getUser()` in the {@link PublicHeader} server wrapper). It
 * NEVER receives or renders any user data — no email, id, or CRP reaches this
 * markup, so an authenticated render leaks no PII to the public HTML.
 *
 * Client responsibilities (the reason this is a Client Component):
 *   - scroll detection to swap the transparent → solid-opaque scrolled state;
 *   - the mobile hamburger menu (open/close, Escape, focus trap, body of links).
 *
 * Design-system constraints honored here:
 *   - scrolled state is a SOLID opaque surface (`bg-surface` + `border-subtle`
 *     bottom border + `shadow-xs`) — NEVER `backdrop-filter`/blur (DS forbids
 *     glassmorphism/blur);
 *   - heights 72px (desktop) / 60px (mobile);
 *   - all interactive targets are ≥44px;
 *   - brand-primary CTA uses the Button `default` variant (`bg-brand-500`).
 */

/** Public navigation links shared by the desktop bar and the mobile menu. */
const NAV_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  // Anchor on the homepage; works as a same-page jump from `/` and as a
  // hash-prefixed link from any other public page (the browser navigates to
  // `/` then scrolls). A path-relative, allowlisted value — not user input.
  { href: '/#funcionalidades', label: 'Funcionalidades' },
  { href: '/precos', label: 'Preços' },
];

export interface PublicHeaderClientProps {
  /** Server-derived: is there a valid Supabase session? Boolean only — no PII. */
  isAuthenticated: boolean;
}

/**
 * The end-of-bar call-to-action cluster. For anonymous visitors it renders the
 * secondary "Entrar" + primary "Começar grátis" pair; for an authenticated
 * visitor it collapses to a single "Acessar plataforma" → `/dashboard` link.
 * No redirect ever happens here — authenticated users stay on the public page.
 */
function HeaderActions({ isAuthenticated }: PublicHeaderClientProps): React.JSX.Element {
  if (isAuthenticated) {
    return (
      <Button asChild size="default">
        <Link href="/dashboard">Acessar plataforma</Link>
      </Button>
    );
  }

  return (
    <>
      <Button asChild variant="ghost" size="default">
        <Link href="/login">Entrar</Link>
      </Button>
      {/* `/signup` CTA preserves UTM params from the current URL (opaque). */}
      <SignupCta size="default">Começar grátis</SignupCta>
    </>
  );
}

export function PublicHeaderClient({
  isAuthenticated,
}: PublicHeaderClientProps): React.JSX.Element {
  const [scrolled, setScrolled] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);

  const menuId = React.useId();
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const toggleRef = React.useRef<HTMLButtonElement | null>(null);

  // Swap to the solid scrolled state once the page leaves the hero. Passive
  // listener; the initial sync covers a deep-link that lands already scrolled.
  React.useEffect(() => {
    function onScroll(): void {
      setScrolled(window.scrollY > 0);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Escape-to-close: returns focus to the toggle so keyboard users are not
  // stranded after dismissing the menu.
  React.useEffect(() => {
    if (!menuOpen) {
      return;
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  // Focus trap: keep Tab/Shift+Tab cycling within the open panel. On open, move
  // focus to the first focusable element inside the panel.
  React.useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    // Narrowed, non-null reference captured for the closure below.
    const panelEl = panel;

    function focusable(): HTMLElement[] {
      return Array.from(
        panelEl.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    }

    const items = focusable();
    items[0]?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Tab') {
        return;
      }
      const els = focusable();
      const first = els[0];
      const last = els[els.length - 1];
      if (!first || !last) {
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    panelEl.addEventListener('keydown', onKeyDown);
    return () => panelEl.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  return (
    <header
      data-scrolled={scrolled ? 'true' : 'false'}
      className={cn(
        // Sticky over the hero. No backdrop-filter / blur (DS prohibition).
        'duration-base sticky top-0 z-50 transition-colors',
        scrolled
          ? 'bg-surface border-border-subtle border-b shadow-xs'
          : 'border-b border-transparent bg-transparent',
      )}
    >
      <Container className="flex h-[60px] items-center justify-between gap-4 md:h-[72px]">
        <Link href="/" aria-label="Hubrity — página inicial" className="flex h-11 items-center">
          <Logo variant="lockup-h" className="h-8 w-auto" />
        </Link>

        {/* Desktop navigation — collapses into the hamburger below `md`. */}
        <nav aria-label="Navegação principal" className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <Button key={link.href} asChild variant="ghost" size="default">
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          <HeaderActions isAuthenticated={isAuthenticated} />
        </div>

        {/* Mobile cluster — the primary CTA stays visible in the bar always. */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          {isAuthenticated ? (
            <Button asChild size="default">
              <Link href="/dashboard">Acessar plataforma</Link>
            </Button>
          ) : (
            // `/signup` CTA preserves UTM params from the current URL (opaque).
            <SignupCta size="default">Começar grátis</SignupCta>
          )}
          <Button
            ref={toggleRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </Button>
        </div>
      </Container>

      {/* Mobile menu panel — rendered only when open; focus-trapped. */}
      {menuOpen ? (
        <div
          id={menuId}
          ref={panelRef}
          className="bg-surface border-border-subtle border-t shadow-xs md:hidden"
        >
          <Container className="flex flex-col gap-1 py-4">
            {NAV_LINKS.map((link) => (
              <Button
                key={link.href}
                asChild
                variant="ghost"
                size="default"
                className="h-11 w-full justify-start"
              >
                <Link href={link.href} onClick={() => setMenuOpen(false)}>
                  {link.label}
                </Link>
              </Button>
            ))}
            {isAuthenticated ? (
              <Button asChild size="default" className="h-11 w-full justify-start">
                <Link href="/dashboard" onClick={() => setMenuOpen(false)}>
                  Acessar plataforma
                </Link>
              </Button>
            ) : (
              <Button asChild variant="ghost" size="default" className="h-11 w-full justify-start">
                <Link href="/login" onClick={() => setMenuOpen(false)}>
                  Entrar
                </Link>
              </Button>
            )}
          </Container>
        </div>
      ) : null}

      {/* No-JS fallback: inline links so the nav is reachable without the
          hamburger when client JS has not (or cannot) run. */}
      <noscript>
        <Container className="flex flex-wrap gap-4 py-3 md:hidden">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-text-primary text-sm">
              {link.label}
            </Link>
          ))}
          {isAuthenticated ? (
            <Link href="/dashboard" className="text-text-primary text-sm">
              Acessar plataforma
            </Link>
          ) : (
            <Link href="/login" className="text-text-primary text-sm">
              Entrar
            </Link>
          )}
        </Container>
      </noscript>
    </header>
  );
}

PublicHeaderClient.displayName = 'PublicHeaderClient';
