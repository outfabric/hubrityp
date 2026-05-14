'use client';

import type { LucideIcon } from 'lucide-react';
import { Calendar, LayoutDashboard, Menu, MessageCircle, Settings, Users, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

import { getTotalUnreadCount } from './actions';

interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  /** When true, a danger badge with the unread count is shown. */
  readonly showUnreadBadge?: boolean;
}

const navItems: readonly NavItem[] = [
  { label: 'Painel', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Pacientes', href: '/pacientes', icon: Users },
  {
    label: 'Caixa de entrada',
    href: '/caixa-de-entrada',
    icon: MessageCircle,
    showUnreadBadge: true,
  },
  { label: 'Agenda', href: '/agenda', icon: Calendar },
  { label: 'Configurações', href: '/configuracoes', icon: Settings },
];

/** Polling interval for unread count refresh (60 seconds). */
const UNREAD_POLL_MS = 60_000;

/**
 * Sidebar navigation for the authenticated app shell.
 *
 * DS Salvia sidebar nav:
 * - Width 240px on desktop (md+), hidden on mobile with a hamburger toggle
 * - bg surface-muted
 * - Item idle: text secondary, padding space-2 space-3, radius md
 * - Item hover: text primary, bg surface
 * - Item active: text brand-700, bg brand-50, border-left 3px brand-500
 * - Mobile: overlay sidebar with backdrop, closes on navigation
 */
export function SidebarNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Fetch total unread count on mount and poll periodically.
  useEffect(() => {
    let cancelled = false;

    async function fetchUnread() {
      try {
        const result = await getTotalUnreadCount();
        if (!cancelled && result.ok) {
          setUnreadCount(result.totalUnread);
        }
      } catch {
        // Silently ignore — sidebar badge is non-critical.
      }
    }

    void fetchUnread();
    const interval = setInterval(() => void fetchUnread(), UNREAD_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const toggleMobile = useCallback(() => {
    setMobileOpen((prev) => !prev);
  }, []);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
  }, []);

  const renderNavItems = (onNavigate?: () => void) =>
    navItems.map((item) => {
      const isActive = pathname.startsWith(item.href);
      const Icon = item.icon;
      const showBadge = item.showUnreadBadge && unreadCount > 0;

      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          className={cn(
            'duration-fast flex items-center gap-3 rounded-md px-3 py-2 text-[15px] font-normal transition-colors',
            isActive
              ? 'border-brand-500 bg-brand-50 text-brand-700 border-l-[3px] pl-[9px] font-medium'
              : 'text-text-secondary hover:bg-surface hover:text-text-primary',
          )}
          aria-current={isActive ? 'page' : undefined}
        >
          <Icon size={20} aria-hidden="true" />
          <span className="flex-1">{item.label}</span>
          {showBadge && (
            <Badge variant="danger" aria-label={`${unreadCount} mensagens nao lidas`}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Link>
      );
    });

  return (
    <>
      {/* Mobile hamburger button — visible only below md breakpoint */}
      <Button
        variant="ghost"
        size="icon"
        className="fixed top-3 left-3 z-50 md:hidden"
        onClick={toggleMobile}
        aria-label={mobileOpen ? 'Fechar menu' : 'Abrir menu'}
        data-testid="sidebar-mobile-toggle"
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </Button>

      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      {/* Mobile sidebar overlay — closes on navigation */}
      <nav
        aria-label="Menu principal"
        className={cn(
          'bg-surface-muted border-border fixed top-0 left-0 z-40 flex h-full w-60 flex-col gap-1 border-r px-3 py-6 pt-16 transition-transform duration-200 md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {renderNavItems(closeMobile)}
      </nav>

      {/* Desktop sidebar — always visible at md+ */}
      <nav
        aria-label="Menu principal"
        className="bg-surface-muted border-border hidden w-60 flex-col gap-1 border-r px-3 py-6 md:flex"
      >
        {renderNavItems()}
      </nav>
    </>
  );
}
