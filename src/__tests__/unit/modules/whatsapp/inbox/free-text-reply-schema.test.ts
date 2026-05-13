import { describe, expect, it } from 'vitest';

import { freeTextReplySchema } from '@/modules/whatsapp/lib/inbox/free-text-reply-schema';

describe('freeTextReplySchema', () => {
  // ------------------------------------------------------------------
  // Valid input
  // ------------------------------------------------------------------

  it('accepts a valid administrative body', () => {
    const result = freeTextReplySchema.safeParse({
      body: 'Olá, sua próxima sessão é amanhã às 14h. Confirma presença?',
    });

    expect(result.success).toBe(true);
  });

  it('accepts a short valid body (1 character)', () => {
    const result = freeTextReplySchema.safeParse({ body: 'k' });

    expect(result.success).toBe(true);
  });

  it('accepts a body at exactly 4096 characters', () => {
    const result = freeTextReplySchema.safeParse({ body: 'a'.repeat(4096) });

    expect(result.success).toBe(true);
  });

  it('accepts typical scheduling messages', () => {
    const result = freeTextReplySchema.safeParse({
      body: 'Bom dia! Preciso remarcar a sessão de quarta para sexta, pode ser?',
    });

    expect(result.success).toBe(true);
  });

  it('accepts payment-related messages', () => {
    const result = freeTextReplySchema.safeParse({
      body: 'Segue o comprovante do PIX referente à sessão de ontem.',
    });

    expect(result.success).toBe(true);
  });

  // ------------------------------------------------------------------
  // Empty / missing body
  // ------------------------------------------------------------------

  it('rejects an empty body', () => {
    const result = freeTextReplySchema.safeParse({ body: '' });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.body?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects when body is missing', () => {
    const result = freeTextReplySchema.safeParse({});

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.body?.length ?? 0).toBeGreaterThan(0);
  });

  // ------------------------------------------------------------------
  // Body exceeding max length
  // ------------------------------------------------------------------

  it('rejects a body longer than 4096 characters', () => {
    const result = freeTextReplySchema.safeParse({ body: 'a'.repeat(4097) });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.body?.length ?? 0).toBeGreaterThan(0);
  });

  // ------------------------------------------------------------------
  // Clinical content refinement — blocked
  // ------------------------------------------------------------------

  it('rejects a body containing a CID-10 code (e.g. F32.1)', () => {
    const result = freeTextReplySchema.safeParse({
      body: 'O paciente apresenta quadro compatível com F32.1',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.body?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects a body with DSM-5 reference', () => {
    const result = freeTextReplySchema.safeParse({
      body: 'Conforme critérios do DSM-5 para transtorno depressivo',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.body?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects a body with diagnostic terminology', () => {
    const result = freeTextReplySchema.safeParse({
      body: 'O paciente apresenta quadro de esquizofrenia',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.body?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects a body with session content references', () => {
    const result = freeTextReplySchema.safeParse({
      body: 'Na evolução da sessão de hoje observamos melhora',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.body?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects a body with psychometric references', () => {
    const result = freeTextReplySchema.safeParse({
      body: 'O resultado do teste indicou percentil 85',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.body?.length ?? 0).toBeGreaterThan(0);
  });

  // ------------------------------------------------------------------
  // Clinical content refinement — error message
  // ------------------------------------------------------------------

  it('includes the clinical-content reason in the error message', () => {
    const result = freeTextReplySchema.safeParse({
      body: 'Diagnóstico F41.0',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    // The reason should mention the CID-10 pattern
    expect(fieldErrors.body?.some((msg) => msg.includes('CID-10'))).toBe(true);
  });
});
