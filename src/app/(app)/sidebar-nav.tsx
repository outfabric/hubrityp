'use client';

import type { LucideIcon } from 'lucide-react';
import { Calendar, LayoutDashboard, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/shared/lib/utils';

interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
}

const navItems: readonly NavItem[] = [
  { label: 'Painel', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Pacientes', href: '/pacientes', icon: Users },
  { label: 'Agenda', href: '/agenda', icon: Calendar },
];

/**
 * Sidebar navigation for the authenticated app shell.
 *
 * DS Salvia sidebar nav:
 * - Width 240px desktop, full overlay mobile (mobile handled separately)
 * - bg surface-muted
 * - Item idle: text secondary, padding space-2 space-3, radius md
 * - Item hover: text primary, bg surface
 * - Item active: text brand-700, bg brand-50, border-left 3px brand-500
 */
export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Menu principal"
      className="bg-surface-muted border-border flex w-60 flex-col gap-1 border-r px-3 py-6"
    >
      {navItems.map((item) => {
        const isActive = pathname.startsWith(item.href);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'duration-fast flex items-center gap-3 rounded-md px-3 py-2 text-[15px] font-normal transition-colors',
              isActive
                ? 'border-brand-500 bg-brand-50 text-brand-700 border-l-[3px] pl-[9px] font-medium'
                : 'text-text-secondary hover:bg-surface hover:text-text-primary',
            )}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon size={20} aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
