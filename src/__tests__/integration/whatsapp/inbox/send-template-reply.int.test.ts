import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import type {
  SendTemplateInput,
  SendTemplateResult,
} from '@/modules/whatsapp/server/adapters/twilio-bsp';
import type { SendTemplateReplyDeps } from '@/modules/whatsapp/server/inbox/send-template-reply';
import { patients } from '@/shared/db/schema/patients/tables';
import {
  messageTemplates,
  whatsappConversations,
  whatsappMessages,
} from '@/shared/db/schema/whatsapp/tables';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

async function seedPatient(
  userId: string,
  patientId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Paciente Teste',
      phone: '+5511988887777',
      ...overrides,
    });
  });
}

async function seedApprovedTemplate(
  userId: string,
  templateKey: string,
  body: string,
  variables: string[],
  contentSid: string,
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(messageTemplates).values({
      userId,
      templateKey,
      body,
      variables,
      metaTemplateId: contentSid,
      metaStatus: 'approved',
      isDefault: true,
    });
  });
}

async function seedPendingTemplate(
  userId: string,
  templateKey: string,
  body: string,
  variables: string[],
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(messageTemplates).values({
      userId,
      templateKey,
      body,
      variables,
      metaTemplateId: null,
      metaStatus: 'pending',
      isDefault: true,
    });
  });
}

function fakeSupabase(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
}

function mockSendTemplateSuccess(bspMessageId = 'SM_mock_template_001'): SendTemplateReplyDeps {
  return {
    sendTemplate: vi.fn().mockResolvedValue({
      ok: true,
      data: { bspMessageId, status: 'queued' },
    } satisfies SendTemplateResult),
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(whatsappConversations);
    await db.delete(whatsappMessages);
    await db.delete(messageTemplates);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sendTemplateReplyImpl — approved template', () => {
  it('sends template successfully and persists as outbound with template_key', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const templateBody = 'Ola, {nome_paciente}! Sua sessao e amanha.';
    await seedApprovedTemplate(
      userId,
      'lembrete_24h',
      templateBody,
      ['nome_paciente'],
      'HX_content_sid_001',
    );

    const { sendTemplateReplyImpl } =
      await import('@/modules/whatsapp/server/inbox/send-template-reply');

    const deps = mockSendTemplateSuccess('SM_template_test_001');

    const result = await sendTemplateReplyImpl(
      fakeSupabase(userId),
      patientId,
      'lembrete_24h',
      { nome_paciente: 'Maria' },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.message.direction).toBe('outbound');
    expect(result.message.templateKey).toBe('lembrete_24h');
    expect(result.message.body).toBe('Ola, Maria! Sua sessao e amanha.');
    expect(result.message.bspMessageId).toBe('SM_template_test_001');
    expect(result.message.status).toBe('sent');

    // Verify adapter was called correctly
    expect(deps.sendTemplate).toHaveBeenCalledOnce();
    const callArgs = (deps.sendTemplate as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as SendTemplateInput;
    expect(callArgs.to).toBe('+5511988887777');
    expect(callArgs.templateKey).toBe('lembrete_24h');
    expect(callArgs.contentSid).toBe('HX_content_sid_001');
    expect(callArgs.variables).toEqual({ nome_paciente: 'Maria' });

    // Verify persisted in DB
    const messages = await runAsService(async (db) => {
      return db
        .select()
        .from(whatsappMessages)
        .where(
          and(eq(whatsappMessages.userId, userId), eq(whatsappMessages.direction, 'outbound')),
        );
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]!.templateKey).toBe('lembrete_24h');
  });
});

describe('sendTemplateReplyImpl — template not approved', () => {
  it('rejects when template is not approved', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await seedPendingTemplate(userId, 'lembrete_24h', 'Ola, {nome_paciente}!', ['nome_paciente']);

    const { sendTemplateReplyImpl } =
      await import('@/modules/whatsapp/server/inbox/send-template-reply');

    const deps = mockSendTemplateSuccess();

    const result = await sendTemplateReplyImpl(
      fakeSupabase(userId),
      patientId,
      'lembrete_24h',
      { nome_paciente: 'Maria' },
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('template_not_approved');

    // Adapter should NOT have been called
    expect(deps.sendTemplate).not.toHaveBeenCalled();
  });
});

describe('sendTemplateReplyImpl — renderTemplate called correctly', () => {
  it('renders template body with variables before sending', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const templateBody =
      'Ola, {nome_paciente}! Sua sessao com {nome_psicologo} e em {data} as {hora}.';
    await seedApprovedTemplate(
      userId,
      'lembrete_24h',
      templateBody,
      ['nome_paciente', 'nome_psicologo', 'data', 'hora'],
      'HX_render_test',
    );

    const { sendTemplateReplyImpl } =
      await import('@/modules/whatsapp/server/inbox/send-template-reply');

    const deps = mockSendTemplateSuccess();

    const result = await sendTemplateReplyImpl(
      fakeSupabase(userId),
      patientId,
      'lembrete_24h',
      {
        nome_paciente: 'Maria',
        nome_psicologo: 'Dra. Ana',
        data: '15/06',
        hora: '14:00',
      },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The persisted body should be the rendered version (rendered locally for
    // the inbox timeline; the Content send itself carries named variables only).
    expect(result.message.body).toBe('Ola, Maria! Sua sessao com Dra. Ana e em 15/06 as 14:00.');

    // The adapter receives the named variables, not a rendered body.
    const callArgs = (deps.sendTemplate as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as SendTemplateInput;
    expect(callArgs.variables).toEqual({
      nome_paciente: 'Maria',
      nome_psicologo: 'Dra. Ana',
      data: '15/06',
      hora: '14:00',
    });
  });

  it('rejects when a required variable is missing', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const templateBody = 'Ola, {nome_paciente}! Sessao com {nome_psicologo}.';
    await seedApprovedTemplate(
      userId,
      'lembrete_24h',
      templateBody,
      ['nome_paciente', 'nome_psicologo'],
      'HX_missing_var',
    );

    const { sendTemplateReplyImpl } =
      await import('@/modules/whatsapp/server/inbox/send-template-reply');

    const deps = mockSendTemplateSuccess();

    // Only provide nome_paciente, missing nome_psicologo
    const result = await sendTemplateReplyImpl(
      fakeSupabase(userId),
      patientId,
      'lembrete_24h',
      { nome_paciente: 'Maria' },
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('render_failed');

    // Adapter should NOT have been called
    expect(deps.sendTemplate).not.toHaveBeenCalled();
  });
});
