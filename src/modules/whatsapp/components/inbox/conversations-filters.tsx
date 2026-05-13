'use client';

import { Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Input } from '@/shared/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InboxFilter = 'all' | 'unread' | 'risk';

interface ConversationsFiltersProps {
  activeFilter: InboxFilter;
  onFilterChange: (filter: InboxFilter) => void;
  onSearchChange: (query: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Filter bar for the inbox conversation list.
 *
 * Renders underline Tabs ("Todas" | "Nao lidas" | "Risco") and a debounced
 * search input. Mobile: tabs stack above search (vertical).
 */
export function ConversationsFilters({
  activeFilter,
  onFilterChange,
  onSearchChange,
}: ConversationsFiltersProps) {
  const [searchValue, setSearchValue] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchValue(value);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        onSearchChange(value);
      }, DEBOUNCE_MS);
    },
    [onSearchChange],
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      {/* Tabs */}
      <Tabs value={activeFilter} onValueChange={(value) => onFilterChange(value as InboxFilter)}>
        <TabsList>
          <TabsTrigger value="all">Todas</TabsTrigger>
          <TabsTrigger value="unread">Nao lidas</TabsTrigger>
          <TabsTrigger value="risk">Risco</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Search input */}
      <div className="relative w-full md:w-64">
        <Search
          size={16}
          className="text-text-tertiary pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          type="text"
          placeholder="Buscar paciente..."
          value={searchValue}
          onChange={handleSearchInput}
          className="pl-9"
          aria-label="Buscar paciente"
        />
      </div>
    </div>
  );
}
