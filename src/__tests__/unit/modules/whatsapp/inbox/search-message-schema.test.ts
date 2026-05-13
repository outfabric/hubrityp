import { describe, expect, it } from 'vitest';

import { searchMessageSchema } from '@/modules/whatsapp/lib/inbox/search-message-schema';

describe('searchMessageSchema', () => {
  // ------------------------------------------------------------------
  // Valid input — minimal
  // ------------------------------------------------------------------

  it('accepts a valid query with defaults', () => {
    const result = searchMessageSchema.safeParse({ query: 'sessão' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.query).toBe('sessão');
    expect(result.data.page).toBe(1);
    expect(result.data.pageSize).toBe(20);
    expect(result.data.patientId).toBeUndefined();
    expect(result.data.dateRange).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // Valid input — full
  // ------------------------------------------------------------------

  it('accepts all fields populated with valid values', () => {
    const result = searchMessageSchema.safeParse({
      query: 'pagamento',
      patientId: '550e8400-e29b-41d4-a716-446655440000',
      dateRange: { from: '2026-01-01', to: '2026-01-31' },
      page: 3,
      pageSize: 50,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.query).toBe('pagamento');
    expect(result.data.patientId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(result.data.dateRange).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(result.data.page).toBe(3);
    expect(result.data.pageSize).toBe(50);
  });

  // ------------------------------------------------------------------
  // Query validation
  // ------------------------------------------------------------------

  it('rejects an empty query', () => {
    const result = searchMessageSchema.safeParse({ query: '' });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.query?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects a query longer than 200 characters', () => {
    const result = searchMessageSchema.safeParse({ query: 'a'.repeat(201) });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.query?.length ?? 0).toBeGreaterThan(0);
  });

  it('accepts a query at exactly 200 characters', () => {
    const result = searchMessageSchema.safeParse({ query: 'a'.repeat(200) });

    expect(result.success).toBe(true);
  });

  it('rejects when query is missing', () => {
    const result = searchMessageSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  // ------------------------------------------------------------------
  // Date range — valid
  // ------------------------------------------------------------------

  it('accepts a dateRange where to equals from (same day)', () => {
    const result = searchMessageSchema.safeParse({
      query: 'test',
      dateRange: { from: '2026-03-15', to: '2026-03-15' },
    });

    expect(result.success).toBe(true);
  });

  it('accepts a dateRange where to is after from', () => {
    const result = searchMessageSchema.safeParse({
      query: 'test',
      dateRange: { from: '2026-01-01', to: '2026-12-31' },
    });

    expect(result.success).toBe(true);
  });

  // ------------------------------------------------------------------
  // Date range — invalid (to < from)
  // ------------------------------------------------------------------

  it('rejects a dateRange where to is before from', () => {
    const result = searchMessageSchema.safeParse({
      query: 'test',
      dateRange: { from: '2026-06-15', to: '2026-06-01' },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    // The error is on the refinement path ['dateRange', 'to']
    const issues = result.error.issues;
    expect(issues.some((i) => i.path.includes('to'))).toBe(true);
  });

  // ------------------------------------------------------------------
  // Date range — invalid format
  // ------------------------------------------------------------------

  it('rejects a dateRange with malformed from date', () => {
    const result = searchMessageSchema.safeParse({
      query: 'test',
      dateRange: { from: 'not-a-date', to: '2026-01-31' },
    });

    expect(result.success).toBe(false);
  });

  it('rejects a dateRange with malformed to date', () => {
    const result = searchMessageSchema.safeParse({
      query: 'test',
      dateRange: { from: '2026-01-01', to: 'invalid' },
    });

    expect(result.success).toBe(false);
  });

  // ------------------------------------------------------------------
  // Patient ID — valid / invalid
  // ------------------------------------------------------------------

  it('accepts a valid UUID patientId', () => {
    const result = searchMessageSchema.safeParse({
      query: 'test',
      patientId: '123e4567-e89b-12d3-a456-426614174000',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an invalid UUID patientId', () => {
    const result = searchMessageSchema.safeParse({
      query: 'test',
      patientId: 'not-a-uuid',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.patientId?.length ?? 0).toBeGreaterThan(0);
  });

  it('accepts when patientId is omitted', () => {
    const result = searchMessageSchema.safeParse({ query: 'test' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.patientId).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // Pagination defaults
  // ------------------------------------------------------------------

  it('defaults page to 1 when not provided', () => {
    const result = searchMessageSchema.safeParse({ query: 'test' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.page).toBe(1);
  });

  it('defaults pageSize to 20 when not provided', () => {
    const result = searchMessageSchema.safeParse({ query: 'test' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pageSize).toBe(20);
  });

  // ------------------------------------------------------------------
  // Pagination bounds
  // ------------------------------------------------------------------

  it('rejects page less than 1', () => {
    const result = searchMessageSchema.safeParse({ query: 'test', page: 0 });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.page?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects a non-integer page', () => {
    const result = searchMessageSchema.safeParse({ query: 'test', page: 1.5 });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.page?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects pageSize less than 10', () => {
    const result = searchMessageSchema.safeParse({ query: 'test', pageSize: 5 });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.pageSize?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects pageSize greater than 100', () => {
    const result = searchMessageSchema.safeParse({ query: 'test', pageSize: 101 });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.pageSize?.length ?? 0).toBeGreaterThan(0);
  });

  it('accepts pageSize at exactly 10 (minimum)', () => {
    const result = searchMessageSchema.safeParse({ query: 'test', pageSize: 10 });

    expect(result.success).toBe(true);
  });

  it('accepts pageSize at exactly 100 (maximum)', () => {
    const result = searchMessageSchema.safeParse({ query: 'test', pageSize: 100 });

    expect(result.success).toBe(true);
  });
});
