'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';
import { DayPicker } from 'react-day-picker';

import { cn } from '@/shared/lib/utils';
import { buttonVariants } from '@/shared/ui/button';

/**
 * Calendar (date-picker) — Salvia design system primitive.
 *
 * Wraps `react-day-picker` with DS tokens and navigation chevrons from
 * Lucide. Used inside a `Popover` for inline date selection (e.g., the
 * agenda nav bar date-picker).
 */

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-2',
        month: 'flex flex-col gap-4',
        month_caption: 'flex justify-center pt-1 relative items-center',
        caption_label: 'text-sm font-medium',
        nav: 'flex items-center gap-1',
        button_previous: cn(
          buttonVariants({ variant: 'outline' }),
          'absolute left-1 h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100',
        ),
        button_next: cn(
          buttonVariants({ variant: 'outline' }),
          'absolute right-1 h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100',
        ),
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'text-text-tertiary rounded-md w-9 font-normal text-[0.8rem]',
        week: 'flex w-full mt-2',
        day: cn(
          'relative p-0 text-center text-sm focus-within:relative focus-within:z-20',
          '[&:has([aria-selected])]:bg-brand-100',
          '[&:has([aria-selected].day-outside)]:bg-brand-100/50',
          '[&:has([aria-selected].day-range-end)]:rounded-r-md',
        ),
        day_button: cn(
          buttonVariants({ variant: 'ghost' }),
          'h-9 w-9 p-0 font-normal aria-selected:opacity-100',
        ),
        range_end: 'day-range-end',
        selected:
          'bg-brand-500 text-text-inverse hover:bg-brand-500 hover:text-text-inverse focus:bg-brand-500 focus:text-text-inverse',
        today: 'bg-surface-muted text-text-primary',
        outside:
          'day-outside text-text-tertiary aria-selected:bg-brand-100/50 aria-selected:text-text-tertiary',
        disabled: 'text-text-disabled opacity-50',
        range_middle: 'aria-selected:bg-brand-100 aria-selected:text-text-primary',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...chevronProps }) => {
          const Icon = orientation === 'left' ? ChevronLeft : ChevronRight;
          return <Icon className="h-4 w-4" {...chevronProps} />;
        },
      }}
      {...props}
    />
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
