import { describe, expect, it } from 'vitest';

import { checkClinicalContent } from '@/modules/whatsapp/lib/inbox/clinical-content-blocker';

// ---------------------------------------------------------------------------
// Administrative text (allowed)
// ---------------------------------------------------------------------------

describe('checkClinicalContent — administrative text (allowed)', () => {
  it('allows "Confirmo seu horário de amanhã"', () => {
    const result = checkClinicalContent('Confirmo seu horário de amanhã às 14h');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('allows a typical session reminder', () => {
    const result = checkClinicalContent(
      'Olá! Lembrete: sua sessão está agendada para amanhã, terça, às 10h.',
    );
    expect(result.allowed).toBe(true);
  });

  it('allows payment-related text', () => {
    const result = checkClinicalContent('Segue o link para pagamento: pix@clinica.com');
    expect(result.allowed).toBe(true);
  });

  it('allows rescheduling text', () => {
    const result = checkClinicalContent(
      'Preciso remarcar a sessão de quinta para sexta, pode ser?',
    );
    expect(result.allowed).toBe(true);
  });

  it('allows a greeting', () => {
    const result = checkClinicalContent('Bom dia! Tudo bem?');
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CID-10 codes (blocked)
// ---------------------------------------------------------------------------

describe('checkClinicalContent — CID-10 codes', () => {
  it('blocks text with CID-10 code F32', () => {
    const result = checkClinicalContent('Paciente com diagnóstico F32');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Código CID-10 detectado');
  });

  it('blocks text with CID-10 code F41.1', () => {
    const result = checkClinicalContent('Código F41.1 confirmado');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Código CID-10 detectado');
  });

  it('blocks text with CID-10 code F20', () => {
    const result = checkClinicalContent('Hipótese diagnóstica: F20');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Código CID-10 detectado');
  });

  it('blocks lowercase cid code f32', () => {
    const result = checkClinicalContent('classificação f32 aplicável');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Código CID-10 detectado');
  });
});

// ---------------------------------------------------------------------------
// DSM-5 references (blocked)
// ---------------------------------------------------------------------------

describe('checkClinicalContent — DSM-5 references', () => {
  it('blocks "DSM-5"', () => {
    const result = checkClinicalContent('Critérios do DSM-5');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Referência ao DSM-5 detectada');
  });

  it('blocks "DSM5" (without hyphen)', () => {
    const result = checkClinicalContent('Conforme DSM5');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Referência ao DSM-5 detectada');
  });

  it('blocks "DSM-IV"', () => {
    const result = checkClinicalContent('Classificação pelo DSM-IV');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Referência ao DSM-5 detectada');
  });
});

// ---------------------------------------------------------------------------
// Diagnostic terms (blocked)
// ---------------------------------------------------------------------------

describe('checkClinicalContent — diagnostic terms', () => {
  it('blocks "transtorno"', () => {
    const result = checkClinicalContent('Apresenta transtorno de personalidade');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Termo diagnóstico detectado');
  });

  it('blocks "depressão maior"', () => {
    const result = checkClinicalContent('Diagnóstico de depressão maior');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Termo diagnóstico detectado');
  });

  it('blocks "depressao maior" (unaccented)', () => {
    const result = checkClinicalContent('Caso de depressao maior');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Termo diagnóstico detectado');
  });

  it('blocks "ansiedade generalizada"', () => {
    const result = checkClinicalContent('Paciente com ansiedade generalizada');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Termo diagnóstico detectado');
  });

  it('blocks "esquizofrenia"', () => {
    const result = checkClinicalContent('Hipótese de esquizofrenia');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Termo diagnóstico detectado');
  });
});

// ---------------------------------------------------------------------------
// Session content markers (blocked)
// ---------------------------------------------------------------------------

describe('checkClinicalContent — session content markers', () => {
  it('blocks "evolução da sessão"', () => {
    const result = checkClinicalContent('Segue a evolução da sessão de hoje');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Conteúdo de sessão clínica detectado');
  });

  it('blocks "sessão de hoje"', () => {
    const result = checkClinicalContent('Na sessão de hoje discutimos...');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Conteúdo de sessão clínica detectado');
  });

  it('blocks "conteúdo da sessão"', () => {
    const result = checkClinicalContent('O conteúdo da sessão foi sobre...');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Conteúdo de sessão clínica detectado');
  });

  it('blocks "relato do paciente"', () => {
    const result = checkClinicalContent('De acordo com o relato do paciente...');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Conteúdo de sessão clínica detectado');
  });

  it('blocks unaccented "sessao de hoje"', () => {
    const result = checkClinicalContent('Na sessao de hoje falamos sobre...');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Conteúdo de sessão clínica detectado');
  });

  it('blocks "evolucao da sessao" (fully unaccented)', () => {
    const result = checkClinicalContent('evolucao da sessao');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Conteúdo de sessão clínica detectado');
  });
});

// ---------------------------------------------------------------------------
// Psychometric references (blocked)
// ---------------------------------------------------------------------------

describe('checkClinicalContent — psychometric references', () => {
  it('blocks "score"', () => {
    const result = checkClinicalContent('O score do paciente é 25');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Referência psicométrica detectada');
  });

  it('blocks "percentil"', () => {
    const result = checkClinicalContent('Resultado no percentil 90');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Referência psicométrica detectada');
  });

  it('blocks "escala"', () => {
    const result = checkClinicalContent('Aplicação da escala Beck');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Referência psicométrica detectada');
  });

  it('blocks "resultado do teste"', () => {
    const result = checkClinicalContent('Segue o resultado do teste');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Referência psicométrica detectada');
  });

  it('blocks "BDI"', () => {
    const result = checkClinicalContent('Resultado BDI: 28');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Referência psicométrica detectada');
  });

  it('blocks "BAI"', () => {
    const result = checkClinicalContent('Score no BAI: 15');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Referência psicométrica detectada');
  });

  it('blocks "WISC"', () => {
    const result = checkClinicalContent('Aplicação do WISC-IV');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Referência psicométrica detectada');
  });
});

// ---------------------------------------------------------------------------
// Reason describes the category
// ---------------------------------------------------------------------------

describe('checkClinicalContent — reason describes category', () => {
  it('reason for CID-10 is descriptive', () => {
    const result = checkClinicalContent('código F41');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/CID-10/);
  });

  it('reason for diagnostic term is descriptive', () => {
    const result = checkClinicalContent('apresenta transtorno');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/diagnóstico/i);
  });

  it('reason for session content is descriptive', () => {
    const result = checkClinicalContent('relato do paciente');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/sessão/i);
  });

  it('reason for psychometric reference is descriptive', () => {
    const result = checkClinicalContent('resultado BDI');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/psicométrica/i);
  });
});

// ---------------------------------------------------------------------------
// Ambiguous text — err on the side of caution
// ---------------------------------------------------------------------------

describe('checkClinicalContent — ambiguous text (caution)', () => {
  it('blocks text mentioning "escala" even in a non-clinical context', () => {
    // "escala" could refer to a music scale, but we err on caution.
    const result = checkClinicalContent('Vamos usar uma escala diferente');
    expect(result.allowed).toBe(false);
  });

  it('blocks text with "transtorno" even in casual use', () => {
    // "transtorno" is sometimes used colloquially ("que transtorno!") but
    // the clinical risk outweighs the inconvenience of blocking.
    const result = checkClinicalContent('Que transtorno, né?');
    expect(result.allowed).toBe(false);
  });
});
