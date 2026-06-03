import { describe, expect, it } from 'vitest';

import {
  CHECKLIST_ITEMS,
  isComplete,
  mandatoryCompletePct,
  type ChecklistItemKey,
  type ChecklistState,
} from '@/modules/onboarding/lib/checklist-items';

// Builds a full checklist state, defaulting every item to `false`, then
// applying the provided overrides. Keeps each test focused on the items it
// cares about without repeating the whole record.
function makeState(overrides: Partial<Record<ChecklistItemKey, boolean>> = {}): ChecklistState {
  const base = Object.fromEntries(CHECKLIST_ITEMS.map((item) => [item.key, false])) as Record<
    ChecklistItemKey,
    boolean
  >;
  return { ...base, ...overrides };
}

const MANDATORY_KEYS: ChecklistItemKey[] = [
  'cadastro_completo',
  'perfil_e_local',
  'primeiro_paciente',
  'primeira_sessao',
  'primeira_evolucao',
  'primeiro_termo',
];

describe('CHECKLIST_ITEMS catalog', () => {
  it('has exactly seven items: six mandatory + one bonus', () => {
    expect(CHECKLIST_ITEMS).toHaveLength(7);
    expect(CHECKLIST_ITEMS.filter((i) => i.mandatory)).toHaveLength(6);
    expect(CHECKLIST_ITEMS.filter((i) => !i.mandatory)).toHaveLength(1);
  });

  it('preserves the documented item ordering', () => {
    expect(CHECKLIST_ITEMS.map((i) => i.key)).toEqual([
      'cadastro_completo',
      'perfil_e_local',
      'primeiro_paciente',
      'primeira_sessao',
      'primeira_evolucao',
      'primeiro_termo',
      'transcricao_ia',
    ]);
  });

  it('marks the six setup items mandatory and only the AI item as bonus', () => {
    for (const key of MANDATORY_KEYS) {
      const item = CHECKLIST_ITEMS.find((i) => i.key === key);
      expect(item?.mandatory, `${key} should be mandatory`).toBe(true);
    }
    const bonus = CHECKLIST_ITEMS.find((i) => i.key === 'transcricao_ia');
    expect(bonus?.mandatory).toBe(false);
  });

  it('gives every item a non-empty label and a server-owned absolute path target', () => {
    for (const item of CHECKLIST_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.actionTarget.startsWith('/')).toBe(true);
    }
  });

  it('uses unique keys', () => {
    const keys = CHECKLIST_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('isComplete', () => {
  it('returns true only for items flagged done in the state', () => {
    const state = makeState({ primeiro_paciente: true });
    expect(isComplete(state, 'primeiro_paciente')).toBe(true);
    expect(isComplete(state, 'primeira_sessao')).toBe(false);
  });
});

describe('mandatoryCompletePct', () => {
  it('is 0 when nothing is done', () => {
    expect(mandatoryCompletePct(makeState())).toBe(0);
  });

  it('reaches 100 when all mandatory items are done and the bonus is still pending', () => {
    const allMandatoryDone: Partial<Record<ChecklistItemKey, boolean>> = {};
    for (const key of MANDATORY_KEYS) {
      allMandatoryDone[key] = true;
    }
    const allMandatory = makeState(allMandatoryDone);
    // Bonus intentionally left pending.
    expect(isComplete(allMandatory, 'transcricao_ia')).toBe(false);
    expect(mandatoryCompletePct(allMandatory)).toBe(100);
  });

  it('excludes the bonus from the denominator: completing only the bonus stays at 0', () => {
    const onlyBonus = makeState({ transcricao_ia: true });
    expect(mandatoryCompletePct(onlyBonus)).toBe(0);
  });

  it('completing the bonus never changes the mandatory percentage', () => {
    const threeMandatory = makeState({
      cadastro_completo: true,
      perfil_e_local: true,
      primeiro_paciente: true,
    });
    const withBonus = { ...threeMandatory, transcricao_ia: true };
    expect(mandatoryCompletePct(threeMandatory)).toBe(50);
    expect(mandatoryCompletePct(withBonus)).toBe(50);
  });

  it('rounds the fraction to the nearest integer percent', () => {
    // 1 of 6 mandatory done -> 16.66.. -> 17.
    expect(mandatoryCompletePct(makeState({ cadastro_completo: true }))).toBe(17);
  });
});
