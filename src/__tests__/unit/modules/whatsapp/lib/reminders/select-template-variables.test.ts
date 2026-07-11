import { describe, expect, it } from 'vitest';

import {
  selectTemplateVariables,
  type SessionForVariables,
  type PatientForVariables,
  type PsychologistForVariables,
  type LocationForVariables,
} from '@/modules/whatsapp/lib/reminders/select-template-variables';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * BRT is UTC-3. Session at 14:00 BRT = 17:00 UTC on 2026-06-16 (Tuesday).
 */
function utcFromBrt(year: number, month: number, day: number, hour: number, min = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour + 3, min, 0, 0));
}

function defaultSession(overrides?: Partial<SessionForVariables>): SessionForVariables {
  return {
    startAt: utcFromBrt(2026, 6, 16, 14, 0), // terça-feira, 16/06/2026 14:00 BRT
    durationMinutes: 50,
    modality: 'in_person',
    videoLink: null,
    confirmationLink: 'https://app.hubrity.com/c/abc123',
    cancelMessage: null,
    sessionValue: 200,
    ...overrides,
  };
}

function defaultPatient(overrides?: Partial<PatientForVariables>): PatientForVariables {
  return {
    firstName: 'Maria',
    fullName: 'Maria Silva',
    ...overrides,
  };
}

function defaultPsychologist(
  overrides?: Partial<PsychologistForVariables>,
): PsychologistForVariables {
  return {
    displayName: 'Dra. Ana',
    ...overrides,
  };
}

function defaultLocation(overrides?: Partial<LocationForVariables>): LocationForVariables {
  return {
    name: 'Consultório Centro',
    address: 'Rua Domingos de Morais, 2564',
    arrivalInstructions: 'Prédio cinza, interfone 42',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Kind 'early' — should have the most variables
// ---------------------------------------------------------------------------

describe('selectTemplateVariables — kind "early"', () => {
  it('returns all applicable variables for early (lembrete_24h)', () => {
    const result = selectTemplateVariables(
      defaultSession(),
      defaultPatient(),
      defaultPsychologist(),
      defaultLocation(),
      'early',
    );

    expect(result).toMatchObject({
      nome_paciente: 'Maria',
      nome_psicologo: 'Dra. Ana',
      data: '16/06/2026',
      dia_semana: 'terça-feira',
      hora: '14:00',
      duracao_min: '50',
      endereco: 'Rua Domingos de Morais, 2564',
      instrucao_chegada: 'Prédio cinza, interfone 42',
      link_confirmacao: 'https://app.hubrity.com/c/abc123',
      valor: 'R$ 200,00',
    });
  });

  it('omits link_video for early kind (not in lembrete_24h applicable templates)', () => {
    const session = defaultSession({ modality: 'online', videoLink: 'https://meet.test/xyz' });
    const result = selectTemplateVariables(
      session,
      defaultPatient(),
      defaultPsychologist(),
      defaultLocation(),
      'early',
    );

    expect(result).not.toHaveProperty('link_video');
  });
});

// ---------------------------------------------------------------------------
// Kind 'video' — link_video present for online sessions
// ---------------------------------------------------------------------------

describe('selectTemplateVariables — kind "video"', () => {
  it('includes link_video for online session', () => {
    const session = defaultSession({ modality: 'online', videoLink: 'https://meet.test/xyz' });
    const result = selectTemplateVariables(
      session,
      defaultPatient(),
      defaultPsychologist(),
      defaultLocation(),
      'video',
    );

    expect(result).toHaveProperty('link_video', 'https://meet.test/xyz');
    expect(result).toHaveProperty('nome_paciente', 'Maria');
    expect(result).toHaveProperty('nome_psicologo', 'Dra. Ana');
  });

  it('omits link_video for in_person session with kind "video"', () => {
    const session = defaultSession({ modality: 'in_person' });
    const result = selectTemplateVariables(
      session,
      defaultPatient(),
      defaultPsychologist(),
      defaultLocation(),
      'video',
    );

    expect(result).not.toHaveProperty('link_video');
  });
});

// ---------------------------------------------------------------------------
// Kind 'confirmed_ack' — no applicable variables
//
// `confirmacao_recebida` was removed from the template model (Option B): the
// confirmation ack is now a free-form message, so no dictionary variable lists
// it in `applicableTemplates`. The selector therefore yields an empty map for
// this kind. (This selector and its whole file are removed in task 3.6.)
// ---------------------------------------------------------------------------

describe('selectTemplateVariables — kind "confirmed_ack"', () => {
  it('returns an empty map (no variable applies to the removed confirmacao_recebida)', () => {
    const result = selectTemplateVariables(
      defaultSession(),
      defaultPatient(),
      defaultPsychologist(),
      defaultLocation(),
      'confirmed_ack',
    );

    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Kind 'cancelled' — data, hora, and message
// ---------------------------------------------------------------------------

describe('selectTemplateVariables — kind "cancelled"', () => {
  it('returns nome_paciente, nome_psicologo, data, and hora', () => {
    const result = selectTemplateVariables(
      defaultSession(),
      defaultPatient(),
      defaultPsychologist(),
      defaultLocation(),
      'cancelled',
    );

    expect(result).toHaveProperty('nome_paciente', 'Maria');
    expect(result).toHaveProperty('nome_psicologo', 'Dra. Ana');
    expect(result).toHaveProperty('data', '16/06/2026');
    expect(result).toHaveProperty('hora', '14:00');
  });
});

// ---------------------------------------------------------------------------
// Kind 'consent' — nome_completo present
// ---------------------------------------------------------------------------

describe('selectTemplateVariables — kind "consent"', () => {
  it('includes nome_completo and nome_paciente', () => {
    const result = selectTemplateVariables(
      defaultSession(),
      defaultPatient(),
      defaultPsychologist(),
      defaultLocation(),
      'consent',
    );

    expect(result).toHaveProperty('nome_paciente', 'Maria');
    expect(result).toHaveProperty('nome_completo', 'Maria Silva');
    expect(result).toHaveProperty('nome_psicologo', 'Dra. Ana');
  });
});

// ---------------------------------------------------------------------------
// Location edge cases
// ---------------------------------------------------------------------------

describe('selectTemplateVariables — location edge cases', () => {
  it('uses location name when address is missing', () => {
    const location = defaultLocation({ address: null });
    const result = selectTemplateVariables(
      defaultSession(),
      defaultPatient(),
      defaultPsychologist(),
      location,
      'early',
    );

    expect(result).toHaveProperty('endereco', 'Consultório Centro');
  });

  it('omits endereco when location is null', () => {
    const result = selectTemplateVariables(
      defaultSession(),
      defaultPatient(),
      defaultPsychologist(),
      null,
      'early',
    );

    expect(result).not.toHaveProperty('endereco');
    expect(result).not.toHaveProperty('instrucao_chegada');
  });
});

// ---------------------------------------------------------------------------
// Modality: online vs in_person for link_video filtering
// ---------------------------------------------------------------------------

describe('selectTemplateVariables — modality filtering', () => {
  it('online session with video kind returns link_video', () => {
    const session = defaultSession({ modality: 'online', videoLink: 'https://meet.test/abc' });
    const result = selectTemplateVariables(
      session,
      defaultPatient(),
      defaultPsychologist(),
      null,
      'video',
    );

    expect(result).toHaveProperty('link_video', 'https://meet.test/abc');
  });

  it('in_person session with video kind omits link_video', () => {
    const session = defaultSession({ modality: 'in_person', videoLink: null });
    const result = selectTemplateVariables(
      session,
      defaultPatient(),
      defaultPsychologist(),
      null,
      'video',
    );

    expect(result).not.toHaveProperty('link_video');
  });
});

// ---------------------------------------------------------------------------
// Video link URL format (populated from video_rooms integration)
// ---------------------------------------------------------------------------

describe('selectTemplateVariables — video link URL format', () => {
  it('populates link_video with correct patient video URL format when videoLink is provided', () => {
    const patientVideoUrl =
      'https://app.hubrity.com/v/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    const session = defaultSession({ modality: 'online', videoLink: patientVideoUrl });
    const result = selectTemplateVariables(
      session,
      defaultPatient(),
      defaultPsychologist(),
      null,
      'video',
    );

    expect(result).toHaveProperty('link_video', patientVideoUrl);
    // Verify the URL follows the expected /v/<token> pattern
    expect(result.link_video).toMatch(/^https:\/\/.+\/v\/[0-9a-f]{64}$/);
  });

  it('omits link_video when videoLink is null (no video room exists yet)', () => {
    const session = defaultSession({ modality: 'online', videoLink: null });
    const result = selectTemplateVariables(
      session,
      defaultPatient(),
      defaultPsychologist(),
      null,
      'video',
    );

    expect(result).not.toHaveProperty('link_video');
  });

  it('omits link_video when videoLink is undefined (no video room exists yet)', () => {
    const session = defaultSession({ modality: 'online', videoLink: undefined });
    const result = selectTemplateVariables(
      session,
      defaultPatient(),
      defaultPsychologist(),
      null,
      'video',
    );

    expect(result).not.toHaveProperty('link_video');
  });
});

// ---------------------------------------------------------------------------
// Unknown kind
// ---------------------------------------------------------------------------

describe('selectTemplateVariables — unknown kind', () => {
  it('returns empty object for unrecognized kind', () => {
    const result = selectTemplateVariables(
      defaultSession(),
      defaultPatient(),
      defaultPsychologist(),
      defaultLocation(),
      'unknown_kind',
    );

    expect(result).toEqual({});
  });
});
