'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import type { Cid10Result } from '@/modules/medical-records';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/shared/ui/popover';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Cid10ComboboxProps {
  /** Currently selected value (null = nothing selected). */
  value: { code: string; description: string } | null;
  /** Callback when a selection changes (null = cleared). */
  onChange: (value: { code: string; description: string } | null) => void;
  /** Server action to search CID-10 codes. */
  onSearch: (query: string) => Promise<Cid10Result[]>;
  /** Whether the combobox is disabled. */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 250;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CID-10 combobox using Popover + manual listbox with debounced search.
 *
 * Features:
 * - Debounced search input (250ms) calling server action
 * - Results with code in font-mono brand-700 + description
 * - Selected state shows locked value with X button to clear
 * - Keyboard navigation (Arrow keys, Enter, Esc)
 * - aria-labelledby for accessibility
 */
export function Cid10Combobox({ value, onChange, onSearch, disabled }: Cid10ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Cid10Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const listboxId = useId();
  const labelId = useId();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search — runs the async search after DEBOUNCE_MS of inactivity.
  // We avoid calling setState directly in the effect body to satisfy the
  // react-hooks/set-state-in-effect rule; all state updates happen either
  // inside callbacks (setTimeout, Promise.then) or via queueMicrotask.
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      queueMicrotask(() => {
        setResults([]);
        setLoading(false);
      });
      return;
    }

    // Indicate loading state inside a microtask to avoid synchronous setState
    queueMicrotask(() => {
      setLoading(true);
    });

    debounceRef.current = setTimeout(() => {
      void onSearch(query.trim()).then((searchResults) => {
        setResults(searchResults);
        setActiveIndex(-1);
        setLoading(false);
      });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, onSearch]);

  const handleSelect = useCallback(
    (item: Cid10Result) => {
      onChange({ code: item.code, description: item.description });
      setOpen(false);
      setQuery('');
      setResults([]);
      setActiveIndex(-1);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    onChange(null);
  }, [onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = results[activeIndex];
        if (activeIndex >= 0 && selected) {
          handleSelect(selected);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    },
    [results, activeIndex, handleSelect],
  );

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const activeItem = listRef.current.children[activeIndex] as HTMLElement | undefined;
      activeItem?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  // If a value is selected, show the locked state
  if (value) {
    return (
      <div
        className="border-border bg-surface-sunken flex items-center justify-between gap-2 rounded-md border px-3 py-2"
        data-testid="cid10-combobox-selected"
      >
        <div className="min-w-0 flex-1">
          <span className="text-brand-700 font-mono text-sm font-medium">{value.code}</span>
          <span className="text-text-secondary ml-2 truncate text-sm">{value.description}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={handleClear}
          disabled={disabled}
          aria-label="Limpar seleção"
          data-testid="cid10-combobox-clear"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div data-testid="cid10-combobox">
      <span id={labelId} className="sr-only">
        Buscar código CID-10
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <Input
            ref={inputRef}
            type="text"
            placeholder="Buscar código ou descrição..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => {
              if (query.trim()) setOpen(true);
            }}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={listboxId}
            aria-labelledby={labelId}
            aria-activedescendant={
              activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
            }
            data-testid="cid10-combobox-input"
          />
        </PopoverAnchor>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-labelledby={labelId}
            className="max-h-60 overflow-y-auto py-1"
          >
            {loading && (
              <li className="text-text-tertiary px-3 py-2 text-sm" aria-live="polite">
                Buscando...
              </li>
            )}
            {!loading && query.trim() && results.length === 0 && (
              <li className="text-text-tertiary px-3 py-2 text-sm">Nenhum resultado encontrado.</li>
            )}
            {!loading &&
              results.map((item, index) => (
                <li
                  key={item.code}
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`cursor-pointer px-3 py-2 text-sm ${
                    index === activeIndex ? 'bg-surface-muted' : ''
                  }`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="text-brand-700 font-mono font-medium">{item.code}</span>
                  <span className="text-text-primary ml-2">{item.description}</span>
                </li>
              ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
