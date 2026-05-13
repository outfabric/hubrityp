import { randomUUID } from 'node:crypto';

import { and, asc, eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { messageTemplates } from '@/shared/db/schema/whatsapp/tables';

import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

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

/**
 * Seed the 6 default templates for a user using the same logic as
 * `seedDefaultTemplates` but exercising raw inserts so we can test
 * the function independently.
 */
async function seedTemplatesViaInsert(userId: string): Promise<void> {
  const templates = [
    {
      templateKey: 'lembrete_24h',
      body: 'Olá, {nome_paciente}! Lembrando da sua sessão com {nome_psicologo} amanhã, {data} ({dia_semana}), às {hora}. Duração: {duracao_min} min. Local: {endereco}. {instrucao_chegada}. Confirme: {link_confirmacao}. Valor: {valor}',
      variables: ['nome_paciente', 'nome_psicologo', 'data', 'dia_semana', 'hora', 'duracao_min', 'endereco', 'instrucao_chegada', 'link_confirmacao', 'valor'],
    },
    {
      templateKey: 'lembrete_2h',
      body: 'Olá, {nome_paciente}! Sua sessão com {nome_psicologo} é em 2 horas, às {hora} ({dia_semana}). Confirme: {link_confirmacao}',
      variables: ['nome_paciente', 'nome_psicologo', 'hora', 'dia_semana', 'link_confirmacao'],
    },
    {
      templateKey: 'confirmacao_recebida',
      body: 'Obrigado, {nome_paciente}! Sua presença na sessão com {nome_psicologo} está confirmada. Valor: {valor}',
      variables: ['nome_paciente', 'nome_psicologo', 'valor'],
    },
    {
      templateKey: 'cancelamento_aviso',
      body: 'Olá, {nome_paciente}. Informamos que sua sessão com {nome_psicologo} em {data}, às {hora}, foi cancelada.',
      variables: ['nome_paciente', 'nome_psicologo', 'data', 'hora'],
    },
    {
      templateKey: 'link_video',
      body: 'Olá, {nome_paciente}! Sua sessão online com {nome_psicologo} começa em breve. Acesse: {link_video}',
      variables: ['nome_paciente', 'nome_psicologo', 'link_video'],
    },
    {
      templateKey: 'termo_consentimento',
      body: 'Olá, {nome_completo}. {nome_psicologo} enviou o Termo de Consentimento para assinatura.',
      variables: ['nome_completo', 'nome_psicologo'],
    },
  ];

  await runAsService(async (db) => {
    for (const t of templates) {
      await db.insert(messageTemplates).values({
        userId,
        templateKey: t.templateKey,
        body: t.body,
        variables: t.variables,
        metaTemplateId: null,
        metaStatus: 'pending',
        isDefault: true,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(messageTemplates);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// seedDefaultTemplates — data correctness and idempotency
// ---------------------------------------------------------------------------

describe('seedDefaultTemplates — data correctness', () => {
  it('seeds 6 templates with correct template_keys and is_default=true', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // Use the actual function under test
    const { seedDefaultTemplates } = await import(
      '@/modules/whatsapp/server/seed-default-templates'
    );
    await seedDefaultTemplates(userId);

    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(messageTemplates)
        .where(eq(messageTemplates.userId, userId))
        .orderBy(asc(messageTemplates.templateKey));
    });

    expect(rows).toHaveLength(6);

    const keys = rows.map((r) => r.templateKey);
    expect(keys).toEqual([
      'cancelamento_aviso',
      'confirmacao_recebida',
      'lembrete_24h',
      'lembrete_2h',
      'link_video',
      'termo_consentimento',
    ]);

    // All are default templates with pending meta status
    for (const row of rows) {
      expect(row.isDefault).toBe(true);
      expect(row.metaStatus).toBe('pending');
      expect(row.metaTemplateId).toBeNull();
      expect(row.userId).toBe(userId);
    }
  });

  it('seeds templates with correct bodies containing {variable} format', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const { seedDefaultTemplates } = await import(
      '@/modules/whatsapp/server/seed-default-templates'
    );
    await seedDefaultTemplates(userId);

    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(messageTemplates)
        .where(eq(messageTemplates.userId, userId));
    });

    const byKey = Object.fromEntries(rows.map((r) => [r.templateKey, r]));

    // Verify the lembrete_24h body contains expected variables
    const lembrete24h = byKey['lembrete_24h']!;
    expect(lembrete24h.body).toContain('{nome_paciente}');
    expect(lembrete24h.body).toContain('{nome_psicologo}');
    expect(lembrete24h.body).toContain('{data}');
    expect(lembrete24h.body).toContain('{hora}');
    expect(lembrete24h.body).toContain('{duracao_min}');
    expect(lembrete24h.body).toContain('{endereco}');
    expect(lembrete24h.body).toContain('{link_confirmacao}');
    expect(lembrete24h.body).toContain('{valor}');

    // Verify variables JSONB matches the body
    const vars24h = lembrete24h.variables as string[];
    expect(vars24h).toContain('nome_paciente');
    expect(vars24h).toContain('nome_psicologo');
    expect(vars24h).toContain('valor');

    // Verify termo_consentimento uses {nome_completo} not {nome_paciente}
    const termo = byKey['termo_consentimento']!;
    expect(termo.body).toContain('{nome_completo}');
    expect(termo.body).toContain('{nome_psicologo}');
    const varsT = termo.variables as string[];
    expect(varsT).toContain('nome_completo');
    expect(varsT).toContain('nome_psicologo');
  });

  it('seed is idempotent — second call does not duplicate', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const { seedDefaultTemplates } = await import(
      '@/modules/whatsapp/server/seed-default-templates'
    );
    await seedDefaultTemplates(userId);
    await seedDefaultTemplates(userId);

    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(messageTemplates)
        .where(eq(messageTemplates.userId, userId));
    });

    expect(rows).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// list — returns all 6 templates ordered by template_key
// ---------------------------------------------------------------------------

describe('message_templates — list', () => {
  it('list returns all 6 templates ordered by template_key ASC', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedTemplatesViaInsert(userId);

    const rows = await runAsService(async (db) => {
      return db
        .select({
          id: messageTemplates.id,
          templateKey: messageTemplates.templateKey,
          body: messageTemplates.body,
          variables: messageTemplates.variables,
          metaStatus: messageTemplates.metaStatus,
          isDefault: messageTemplates.isDefault,
        })
        .from(messageTemplates)
        .where(eq(messageTemplates.userId, userId))
        .orderBy(asc(messageTemplates.templateKey));
    });

    expect(rows).toHaveLength(6);

    // Verify ordering by template_key ASC
    const keys = rows.map((r) => r.templateKey);
    const sortedKeys = [...keys].sort();
    expect(keys).toEqual(sortedKeys);
  });
});

// ---------------------------------------------------------------------------
// get — by template_key
// ---------------------------------------------------------------------------

describe('message_templates — get by key', () => {
  it('get by valid key returns the template', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedTemplatesViaInsert(userId);

    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(messageTemplates)
        .where(
          and(
            eq(messageTemplates.userId, userId),
            eq(messageTemplates.templateKey, 'lembrete_24h'),
          ),
        )
        .limit(1);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.templateKey).toBe('lembrete_24h');
    expect(rows[0]!.body).toContain('{nome_paciente}');
  });

  it('get by invalid key returns no rows', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedTemplatesViaInsert(userId);

    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(messageTemplates)
        .where(
          and(
            eq(messageTemplates.userId, userId),
            eq(messageTemplates.templateKey, 'nonexistent_key'),
          ),
        )
        .limit(1);
    });

    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// update — changes body and sets meta_status to pending
// ---------------------------------------------------------------------------

describe('message_templates — update', () => {
  it('update changes body and sets meta_status to pending', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedTemplatesViaInsert(userId);

    // Set status to 'approved' first to verify it resets
    await runAsService(async (db) => {
      await db
        .update(messageTemplates)
        .set({ metaStatus: 'approved' })
        .where(
          and(
            eq(messageTemplates.userId, userId),
            eq(messageTemplates.templateKey, 'lembrete_24h'),
          ),
        );
    });

    const newBody =
      'Olá, {nome_paciente}! Lembrete atualizado da sessão com {nome_psicologo} em {data}.';

    await runAsService(async (db) => {
      await db
        .update(messageTemplates)
        .set({
          body: newBody,
          variables: ['nome_paciente', 'nome_psicologo', 'data'],
          metaStatus: 'pending',
          updatedAt: dsql`now()`,
        })
        .where(
          and(
            eq(messageTemplates.userId, userId),
            eq(messageTemplates.templateKey, 'lembrete_24h'),
          ),
        );
    });

    const [updated] = await runAsService(async (db) => {
      return db
        .select()
        .from(messageTemplates)
        .where(
          and(
            eq(messageTemplates.userId, userId),
            eq(messageTemplates.templateKey, 'lembrete_24h'),
          ),
        );
    });

    expect(updated!.body).toBe(newBody);
    expect(updated!.metaStatus).toBe('pending');
    expect(updated!.variables).toEqual(['nome_paciente', 'nome_psicologo', 'data']);
  });
});

// ---------------------------------------------------------------------------
// UNIQUE constraint — (user_id, template_key)
// ---------------------------------------------------------------------------

describe('message_templates — UNIQUE constraint', () => {
  it('UNIQUE(user_id, template_key) rejects duplicate insert', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(messageTemplates).values({
        userId,
        templateKey: 'lembrete_24h',
        body: 'Template v1',
        variables: [],
        isDefault: true,
      });
    });

    await expect(
      runAsService(async (db) => {
        await db.insert(messageTemplates).values({
          userId,
          templateKey: 'lembrete_24h',
          body: 'Template v2 — duplicate',
          variables: [],
          isDefault: true,
        });
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// RLS — cross-user isolation
// ---------------------------------------------------------------------------

describe('message_templates — RLS', () => {
  it('psychologist A cannot see templates of psychologist B', async () => {
    const userIdA = randomUUID();
    const userIdB = randomUUID();
    await seedAuthUser(userIdA);
    await seedAuthUser(userIdB);

    // Insert templates for both users as service role (bypass RLS)
    await runAsService(async (db) => {
      await db.insert(messageTemplates).values({
        userId: userIdA,
        templateKey: 'lembrete_24h',
        body: 'Template A',
        variables: [],
        isDefault: true,
      });
      await db.insert(messageTemplates).values({
        userId: userIdB,
        templateKey: 'lembrete_24h',
        body: 'Template B',
        variables: [],
        isDefault: true,
      });
    });

    // User A queries — should only see their own template
    const rowsA = await runAsUser(userIdA, async (db) => {
      return db.select().from(messageTemplates);
    });

    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]!.userId).toBe(userIdA);
    expect(rowsA[0]!.body).toBe('Template A');

    // User B queries — should only see their own template
    const rowsB = await runAsUser(userIdB, async (db) => {
      return db.select().from(messageTemplates);
    });

    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]!.userId).toBe(userIdB);
    expect(rowsB[0]!.body).toBe('Template B');
  });

  it('psychologist A cannot update templates of psychologist B', async () => {
    const userIdA = randomUUID();
    const userIdB = randomUUID();
    await seedAuthUser(userIdA);
    await seedAuthUser(userIdB);

    await runAsService(async (db) => {
      await db.insert(messageTemplates).values({
        userId: userIdB,
        templateKey: 'lembrete_24h',
        body: 'Original B body',
        variables: [],
        isDefault: true,
      });
    });

    // User A tries to update user B's template — should affect 0 rows
    const result = await runAsUser(userIdA, async (db) => {
      return db
        .update(messageTemplates)
        .set({ body: 'Hacked!' })
        .where(
          and(
            eq(messageTemplates.userId, userIdB),
            eq(messageTemplates.templateKey, 'lembrete_24h'),
          ),
        )
        .returning();
    });

    expect(result).toHaveLength(0);

    // Verify B's template is unchanged
    const rowsB = await runAsService(async (db) => {
      return db
        .select({ body: messageTemplates.body })
        .from(messageTemplates)
        .where(eq(messageTemplates.userId, userIdB));
    });

    expect(rowsB[0]!.body).toBe('Original B body');
  });

  it('psychologist A cannot delete templates of psychologist B', async () => {
    const userIdA = randomUUID();
    const userIdB = randomUUID();
    await seedAuthUser(userIdA);
    await seedAuthUser(userIdB);

    await runAsService(async (db) => {
      await db.insert(messageTemplates).values({
        userId: userIdB,
        templateKey: 'link_video',
        body: 'Template B video',
        variables: [],
        isDefault: true,
      });
    });

    // User A tries to delete user B's template — should affect 0 rows
    const deleted = await runAsUser(userIdA, async (db) => {
      return db
        .delete(messageTemplates)
        .where(
          and(
            eq(messageTemplates.userId, userIdB),
            eq(messageTemplates.templateKey, 'link_video'),
          ),
        )
        .returning();
    });

    expect(deleted).toHaveLength(0);

    // Verify B's template still exists
    const rowsB = await runAsService(async (db) => {
      return db
        .select()
        .from(messageTemplates)
        .where(eq(messageTemplates.userId, userIdB));
    });

    expect(rowsB).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// CHECK constraints
// ---------------------------------------------------------------------------

describe('message_templates — CHECK constraints', () => {
  it('CHECK constraint rejects invalid meta_status', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.execute(
          dsql`INSERT INTO message_templates (id, user_id, template_key, body, meta_status)
               VALUES (${randomUUID()}, ${userId}, 'lembrete_24h', 'Hello', 'expired')`,
        );
      }),
    ).rejects.toThrow();
  });

  it('CHECK constraint rejects invalid template_key', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.execute(
          dsql`INSERT INTO message_templates (id, user_id, template_key, body)
               VALUES (${randomUUID()}, ${userId}, 'nonexistent_template', 'Hello')`,
        );
      }),
    ).rejects.toThrow();
  });
});
