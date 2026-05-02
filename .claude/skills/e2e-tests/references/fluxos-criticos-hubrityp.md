# Fluxos críticos do HubrityP que merecem E2E

E2E é caro. A pirâmide vale: **poucos testes, alto valor**. Use esta lista como mapa do que cobrir e do que **não** cobrir.

## Cobrir (1 teste por jornada)

| Jornada | Spec sugerido | Asserções principais |
|---|---|---|
| Login + acesso ao dashboard | `auth.spec.ts` | redireciona após login; estado persistido em refresh; logout limpa sessão |
| Cadastro de paciente | `paciente.spec.ts` | cria via form, aparece na lista, dados persistidos no DB |
| Agendamento de consulta | `agendamento.spec.ts` | cria, aparece no calendário, dispara mock do Twilio com payload correto |
| Lembrete WhatsApp | dentro de `agendamento.spec.ts` | webhook do Twilio recebido marca lembrete como entregue |
| Receita digital (Receita Saúde) | `receita.spec.ts` | gera, mostra QR, mock de assinatura digital fluiu |
| Cobrança PIX | `cobranca-pix.spec.ts` | cria via UI, webhook Asaas marca como paga, status reflete na UI |
| Sessão de telepsicologia (Stream.io) | `telepsicologia.spec.ts` | gera link, abre sala (mock do iframe), encerramento atualiza prontuário |
| Prontuário (criação + transcrição) | `prontuario.spec.ts` | criar nota, mock de Gemini transcreve, conteúdo aparece |
| Isolamento entre psicólogos | `multi-tenant.spec.ts` | dr B não vê pacientes de dr A na UI |

Total: ~9 specs, ~15 testes. CI roda em <5min.

## NÃO cobrir em E2E

Migre para a pirâmide correta:

- **Validações de form** (CPF inválido, campo obrigatório) → unit do schema Zod (`unit-tests`).
- **Cálculo de honorário** → unit da função.
- **Permissão de RLS** (dr B não consegue queryar pacientes de dr A no banco) → integração (`integration-tests`).
- **Edge cases de horário** (consulta no domingo, feriado, fuso) → integração da Server Action.
- **Erros de Server Action** (paciente duplicado, agendamento sobreposto) → integração.
- **Renderização de cada estado de loading/erro** isoladamente → unit de componente.

A heurística: se o teste prova "**a feature funciona quando um humano usa o app**", é E2E. Se prova "**uma regra de negócio é correta**", é unit ou integração.

## Smoke test pós-deploy (subset reduzido)

Após deploy, rode um subset que aponta para staging/produção com seed user dedicado:

- Login + dashboard carrega.
- Lista de pacientes responde em <2s.
- Endpoint de health-check `/api/health` retorna 200.

Configure como project separado (`smoke`) no `playwright.config.ts` com `baseURL` apontando para o ambiente:

```ts
{
  name: 'smoke',
  testMatch: /.*\.smoke\.spec\.ts/,
  use: { baseURL: process.env.SMOKE_BASE_URL },
  // sem dependencies (não roda Testcontainers)
}
```

Acionado com `npx playwright test --project=smoke` em job pós-deploy.

## Quando adicionar novo E2E

Critérios cumulativos:

1. A jornada cruza **mais de um sistema** (UI + Server Action + DB + integração externa).
2. Falha silenciosa custa dinheiro/reputação (cobrança não criada, lembrete não enviado).
3. Não é coberto pelas camadas inferiores.

Se 2 ou 3 não bate, **não crie**. Suite E2E que cresce sem disciplina morre por flakiness em 6 meses.

## Quando remover E2E

- Cobre regra de negócio que migrou para unit/integration.
- Falha intermitente >5% mesmo após investigação séria — cobertura ruim é pior que nenhuma.
- Duplica jornada já coberta (ex.: dois testes diferentes que ambos exercitam "criar paciente").

Documente a remoção no PR — alguém vai perguntar por que sumiu.
