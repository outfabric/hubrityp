import { describe, expect, it, vi } from 'vitest';

import { pseudonymizeTranscript } from '@/modules/ai-transcription';

describe('pseudonymizeTranscript', () => {
  it('(a) replaces full name and first name', () => {
    const result = pseudonymizeTranscript({
      patientFirstName: 'Maria',
      patientFullName: 'Maria Clara Silva',
      transcript: 'A Maria Clara Silva relatou que Maria está bem.',
    });

    expect(result).not.toContain('Maria');
    expect(result).not.toContain('Clara');
    expect(result).not.toContain('Silva');
    expect(result).toContain('Paciente');
  });

  it('(b) is case-insensitive', () => {
    const result = pseudonymizeTranscript({
      patientFirstName: 'João',
      patientFullName: 'João Pereira',
      transcript: 'O JOÃO falou que joão está melhor. Pereira confirmou.',
    });

    expect(result).not.toMatch(/joão/i);
    expect(result).not.toMatch(/pereira/i);
    expect(result).toContain('Paciente');
  });

  it('(c) does NOT replace short substrings (tokens with length <= 2)', () => {
    const result = pseudonymizeTranscript({
      patientFirstName: 'Ana',
      patientFullName: 'Ana Lu de Souza',
      transcript: 'A luz estava forte na sala quando Ana de Souza entrou.',
    });

    // "Lu" (length 2) and "de" (length 2) should NOT be replaced
    // "Ana" and "Souza" (length > 2) SHOULD be replaced
    expect(result).not.toContain('Ana');
    expect(result).not.toContain('Souza');
    // "luz" is a different word from "Lu" — it should remain untouched
    expect(result).toContain('luz');
    // "de" is short and should NOT be replaced
    expect(result).toContain('de');
  });

  it('(d) is idempotent on already-pseudonymized text', () => {
    const input = {
      patientFirstName: 'Carlos',
      patientFullName: 'Carlos Mendes',
      transcript: 'O Paciente relatou que Paciente está bem.',
    };

    const first = pseudonymizeTranscript(input);
    const second = pseudonymizeTranscript({
      ...input,
      transcript: first,
    });

    expect(second).toBe(first);
  });

  it('(e) handles transcripts that do not mention the patient (returns input unchanged)', () => {
    const transcript = 'A sessão foi produtiva e sem intercorrências.';
    const result = pseudonymizeTranscript({
      patientFirstName: 'Fernanda',
      patientFullName: 'Fernanda Oliveira',
      transcript,
    });

    expect(result).toBe(transcript);
  });

  it('(f) does not mutate input', () => {
    const input = {
      patientFirstName: 'Pedro',
      patientFullName: 'Pedro Santos',
      transcript: 'Pedro Santos chegou na hora.',
    };

    const transcriptBefore = input.transcript;
    pseudonymizeTranscript(input);

    expect(input.transcript).toBe(transcriptBefore);
    expect(input.patientFirstName).toBe('Pedro');
    expect(input.patientFullName).toBe('Pedro Santos');
  });

  it('(g) does not log (mock the global logger and assert zero calls)', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    pseudonymizeTranscript({
      patientFirstName: 'Maria',
      patientFullName: 'Maria Silva',
      transcript: 'Maria Silva está bem.',
    });

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleInfoSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
  });
});
