import { describe, expect, it } from 'vitest';

import { detectRiskKeywords } from '@/modules/whatsapp/lib/inbox/detect-risk-keywords';

// ---------------------------------------------------------------------------
// Exact keyword detection
// ---------------------------------------------------------------------------

describe('detectRiskKeywords — exact matches', () => {
  it('detects "me matar"', () => {
    const result = detectRiskKeywords('eu quero me matar');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('me matar');
  });

  it('detects "suicídio" (accented)', () => {
    const result = detectRiskKeywords('penso em suicídio');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('suicidio');
  });

  it('detects "quero morrer"', () => {
    const result = detectRiskKeywords('eu quero morrer');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('quero morrer');
  });

  it('detects "acabar com tudo"', () => {
    const result = detectRiskKeywords('vou acabar com tudo');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('acabar com tudo');
  });

  it('detects "autolesão" (accented)', () => {
    const result = detectRiskKeywords('tenho pensamentos de autolesão');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('autolesao');
  });

  it('detects "me cortar"', () => {
    const result = detectRiskKeywords('eu quero me cortar');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('me cortar');
  });

  it('detects "sumir pra sempre"', () => {
    const result = detectRiskKeywords('quero sumir pra sempre');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('sumir pra sempre');
  });

  it('detects "tirar minha vida"', () => {
    const result = detectRiskKeywords('penso em tirar minha vida');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('tirar minha vida');
  });

  it('detects "desistir de tudo"', () => {
    const result = detectRiskKeywords('quero desistir de tudo');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('desistir de tudo');
  });

  it('detects "não aguento mais" (accented)', () => {
    const result = detectRiskKeywords('não aguento mais viver assim');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('nao aguento mais');
  });

  it('detects "não quero mais viver" (accented)', () => {
    const result = detectRiskKeywords('não quero mais viver');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('nao quero mais viver');
  });

  it('detects "suicidar"', () => {
    const result = detectRiskKeywords('quero me suicidar');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('suicidar');
  });
});

// ---------------------------------------------------------------------------
// Accent-insensitive matching
// ---------------------------------------------------------------------------

describe('detectRiskKeywords — accent variants', () => {
  it('detects "suicidio" (unaccented) the same as "suicídio"', () => {
    const result = detectRiskKeywords('penso em suicidio');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('suicidio');
  });

  it('detects "autolesao" (unaccented) the same as "autolesão"', () => {
    const result = detectRiskKeywords('penso em autolesao');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('autolesao');
  });

  it('detects "nao aguento mais" (unaccented)', () => {
    const result = detectRiskKeywords('nao aguento mais');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('nao aguento mais');
  });

  it('detects "nao quero mais viver" (unaccented)', () => {
    const result = detectRiskKeywords('nao quero mais viver');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('nao quero mais viver');
  });
});

// ---------------------------------------------------------------------------
// Case-insensitive matching
// ---------------------------------------------------------------------------

describe('detectRiskKeywords — case-insensitive', () => {
  it('detects "ME MATAR" (upper case)', () => {
    const result = detectRiskKeywords('EU QUERO ME MATAR');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('me matar');
  });

  it('detects "Suicídio" (title case)', () => {
    const result = detectRiskKeywords('Penso em Suicídio');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('suicidio');
  });

  it('detects "QUERO MORRER" (all caps)', () => {
    const result = detectRiskKeywords('QUERO MORRER');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('quero morrer');
  });
});

// ---------------------------------------------------------------------------
// Multiple keywords in the same text
// ---------------------------------------------------------------------------

describe('detectRiskKeywords — multiple keywords', () => {
  it('returns all matched keywords when text contains multiple', () => {
    const result = detectRiskKeywords('eu quero me matar, penso em suicídio e quero morrer');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('me matar');
    expect(result.keywords).toContain('suicidio');
    expect(result.keywords).toContain('quero morrer');
    expect(result.keywords.length).toBeGreaterThanOrEqual(3);
  });

  it('returns unique keywords (no duplicates)', () => {
    const result = detectRiskKeywords('me matar me matar me matar');
    expect(result.flagged).toBe(true);
    // The regex matches presence, not count — keyword appears once.
    expect(result.keywords.filter((k) => k === 'me matar')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// False-positive exclusions
// ---------------------------------------------------------------------------

describe('detectRiskKeywords — false positives excluded', () => {
  it('does NOT flag "matar saudade"', () => {
    const result = detectRiskKeywords('vou matar saudade da comida da vó');
    expect(result.flagged).toBe(false);
    expect(result.keywords).toEqual([]);
  });

  it('does NOT flag "morrer de rir"', () => {
    const result = detectRiskKeywords('essa piada me fez morrer de rir');
    expect(result.flagged).toBe(false);
    expect(result.keywords).toEqual([]);
  });

  it('does NOT flag "morrer de vontade"', () => {
    const result = detectRiskKeywords('estou morrendo de vontade de pizza');
    // "morrendo" != "morrer" so it would not match "quero morrer" anyway,
    // but let's verify explicit "morrer de vontade".
    const result2 = detectRiskKeywords('vou morrer de vontade de ir');
    expect(result.flagged).toBe(false);
    expect(result2.flagged).toBe(false);
  });

  it('does NOT flag "matar a fome"', () => {
    const result = detectRiskKeywords('preciso matar a fome');
    expect(result.flagged).toBe(false);
    expect(result.keywords).toEqual([]);
  });

  it('flags when a real keyword appears alongside a false positive', () => {
    const result = detectRiskKeywords('quero matar saudade mas também quero me matar');
    expect(result.flagged).toBe(true);
    expect(result.keywords).toContain('me matar');
  });
});

// ---------------------------------------------------------------------------
// Neutral text (no match)
// ---------------------------------------------------------------------------

describe('detectRiskKeywords — neutral text', () => {
  it('does not flag "confirmo a sessão"', () => {
    const result = detectRiskKeywords('confirmo a sessão de amanhã às 14h');
    expect(result.flagged).toBe(false);
    expect(result.keywords).toEqual([]);
  });

  it('does not flag an empty string', () => {
    const result = detectRiskKeywords('');
    expect(result.flagged).toBe(false);
    expect(result.keywords).toEqual([]);
  });

  it('does not flag typical appointment text', () => {
    const result = detectRiskKeywords('Boa tarde, gostaria de remarcar a consulta para sexta');
    expect(result.flagged).toBe(false);
    expect(result.keywords).toEqual([]);
  });

  it('returns empty keywords array when no match', () => {
    const result = detectRiskKeywords('tudo bem, obrigado');
    expect(result.keywords).toEqual([]);
  });
});
