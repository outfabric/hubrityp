import fs from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import type { RiskSensitivity } from '@/modules/ai-transcription/lib/schemas';
import type { TranscriptionTemplate } from '@/modules/ai-transcription/lib/schemas';
import {
  getNotePromptModule,
  TRANSCRIPTION_PROMPT_VERSION,
  TRANSCRIPTION_SYSTEM_INSTRUCTION,
} from '@/modules/ai-transcription/server/prompts/index';

const ALL_TEMPLATES: TranscriptionTemplate[] = ['tcc', 'psicanalise', 'sistemica', 'aba', 'livre'];
const ALL_SENSITIVITIES: RiskSensitivity[] = ['low', 'medium', 'high'];

// ---------------------------------------------------------------------------
// (a) All 5 templates are resolvable via getNotePromptModule
// ---------------------------------------------------------------------------

describe('getNotePromptModule', () => {
  it.each(ALL_TEMPLATES)('resolves template "%s" and returns a valid module', (template) => {
    const mod = getNotePromptModule(template);

    expect(mod).toBeDefined();
    expect(typeof mod.PROMPT_VERSION).toBe('number');
    expect(typeof mod.buildSystemInstruction).toBe('function');
  });

  it('returns distinct modules for each template', () => {
    const modules = ALL_TEMPLATES.map((t) => getNotePromptModule(t));
    const unique = new Set(modules);
    expect(unique.size).toBe(ALL_TEMPLATES.length);
  });
});

// ---------------------------------------------------------------------------
// (b) Each prompt includes mandatory safety strings
// ---------------------------------------------------------------------------

describe('mandatory safety strings in prompts', () => {
  describe.each(ALL_TEMPLATES)('template "%s"', (template) => {
    it.each(ALL_SENSITIVITIES)(
      'with sensitivity "%s" includes "Não invente conteúdo"',
      (sensitivity) => {
        const mod = getNotePromptModule(template);
        const instruction = mod.buildSystemInstruction(sensitivity);
        expect(instruction).toContain('Não invente conteúdo');
      },
    );

    it.each(ALL_SENSITIVITIES)(
      'with sensitivity "%s" includes "[não mencionado]"',
      (sensitivity) => {
        const mod = getNotePromptModule(template);
        const instruction = mod.buildSystemInstruction(sensitivity);
        expect(instruction).toContain('[não mencionado]');
      },
    );

    it.each(ALL_SENSITIVITIES)(
      'with sensitivity "%s" includes "Não faça interpretações clínicas profundas"',
      (sensitivity) => {
        const mod = getNotePromptModule(template);
        const instruction = mod.buildSystemInstruction(sensitivity);
        expect(instruction).toContain('Não faça interpretações clínicas profundas');
      },
    );
  });
});

// ---------------------------------------------------------------------------
// (c) Different sensitivity values produce different strings
// ---------------------------------------------------------------------------

describe('sensitivity produces different instructions', () => {
  it.each(ALL_TEMPLATES)(
    'template "%s" returns different strings for low/medium/high',
    (template) => {
      const mod = getNotePromptModule(template);

      const low = mod.buildSystemInstruction('low');
      const medium = mod.buildSystemInstruction('medium');
      const high = mod.buildSystemInstruction('high');

      // All three must be distinct from each other.
      expect(low).not.toBe(medium);
      expect(low).not.toBe(high);
      expect(medium).not.toBe(high);
    },
  );

  it('low sensitivity includes "APENAS"', () => {
    const mod = getNotePromptModule('tcc');
    const instruction = mod.buildSystemInstruction('low');
    expect(instruction).toContain('APENAS');
  });

  it('medium sensitivity includes "fortes hipóteses"', () => {
    const mod = getNotePromptModule('tcc');
    const instruction = mod.buildSystemInstruction('medium');
    expect(instruction).toContain('fortes hipóteses');
  });

  it('high sensitivity includes "qualquer indício"', () => {
    const mod = getNotePromptModule('tcc');
    const instruction = mod.buildSystemInstruction('high');
    expect(instruction).toContain('qualquer indício');
  });
});

// ---------------------------------------------------------------------------
// (d) PROMPT_VERSION is a positive integer in each file
// ---------------------------------------------------------------------------

describe('PROMPT_VERSION', () => {
  it.each(ALL_TEMPLATES)('template "%s" has a positive integer PROMPT_VERSION', (template) => {
    const mod = getNotePromptModule(template);
    expect(Number.isInteger(mod.PROMPT_VERSION)).toBe(true);
    expect(mod.PROMPT_VERSION).toBeGreaterThan(0);
  });

  it('transcription prompt has a positive integer PROMPT_VERSION', () => {
    expect(Number.isInteger(TRANSCRIPTION_PROMPT_VERSION)).toBe(true);
    expect(TRANSCRIPTION_PROMPT_VERSION).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Transcription system instruction
// ---------------------------------------------------------------------------

describe('TRANSCRIPTION_SYSTEM_INSTRUCTION', () => {
  it('is a non-empty pt-BR string', () => {
    expect(typeof TRANSCRIPTION_SYSTEM_INSTRUCTION).toBe('string');
    expect(TRANSCRIPTION_SYSTEM_INSTRUCTION.length).toBeGreaterThan(0);
  });

  it('instructs not to interpret', () => {
    expect(TRANSCRIPTION_SYSTEM_INSTRUCTION).toContain('Não interprete');
  });
});

// ---------------------------------------------------------------------------
// server-only guard on all prompt files
// ---------------------------------------------------------------------------

describe('server-only guard', () => {
  const PROMPT_DIR = path.resolve(
    __dirname,
    '../../../../../../modules/ai-transcription/server/prompts',
  );

  const promptFiles = [
    'transcription.ts',
    'note-tcc.ts',
    'note-psicanalise.ts',
    'note-sistemica.ts',
    'note-aba.ts',
    'note-livre.ts',
    'shared.ts',
    'index.ts',
  ];

  it.each(promptFiles)('%s starts with import "server-only"', (fileName) => {
    const filePath = path.join(PROMPT_DIR, fileName);
    const source = fs.readFileSync(filePath, 'utf-8');
    const lines = source.split('\n').filter((l) => l.trim().length > 0);
    const firstNonEmpty = lines[0]?.trim();
    expect(firstNonEmpty).toBe("import 'server-only';");
  });
});
