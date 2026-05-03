import { describe, expect, it } from 'vitest';

import { cn } from '@/shared/lib/utils';

describe('cn()', () => {
  it('merges conflicting Tailwind utility classes via tailwind-merge', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('ignores falsy inputs', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('joins multiple class fragments', () => {
    expect(cn('flex', 'items-center', 'gap-2')).toBe('flex items-center gap-2');
  });

  it('supports conditional class objects', () => {
    expect(cn('base', { active: true, disabled: false })).toBe('base active');
  });
});
