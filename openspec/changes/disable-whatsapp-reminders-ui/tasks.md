## 1. Feature flag de ambiente

- [x] 1.1 Adicionar `NEXT_PUBLIC_WHATSAPP_UI_ENABLED` ao `clientEnvSchema` em `src/shared/env/client-schema.ts` usando `z.enum(['true','false']).default('false').transform((v) => v === 'true')`
- [x] 1.2 Incluir a chave `NEXT_PUBLIC_WHATSAPP_UI_ENABLED` no objeto parseado em `src/shared/env/client.ts` (ler de `process.env`)
- [x] 1.3 Documentar a variável em `.env.example` (com comentário explicando default `false` e que mudar exige rebuild do frontend por ser `NEXT_PUBLIC_`)
- [x] 1.4 Adicionar `NEXT_PUBLIC_WHATSAPP_UI_ENABLED: "false"` ao serviço da app em `docker-compose.yml`

## 2. Menu lateral — "Caixa de entrada"

- [x] 2.1 Estender a interface `NavItem` em `src/app/(app)/sidebar-nav.tsx` com `disabled?: boolean` e `comingSoon?: boolean`
- [x] 2.2 Derivar `disabled`/`comingSoon` do item "Caixa de entrada" a partir de `!clientEnv.NEXT_PUBLIC_WHATSAPP_UI_ENABLED`
- [x] 2.3 Atualizar `renderNavItems()`: quando `disabled`, renderizar `<span>` (não `<Link>`), com classes do token `text-disabled`, `aria-disabled="true"`, `cursor-not-allowed`, sem estados hover/active de `brand` e sem underline
- [x] 2.4 Suprimir o badge de não-lidas (`showUnreadBadge`) quando o item está congelado e anexar `<Badge variant="neutral">Em breve</Badge>` ao lado do rótulo
- [x] 2.5 Garantir que o item não seja focável/ativável por teclado para navegação (sem `href`/role de link)

## 3. Configurações — cards "WhatsApp" e "Lembretes"

- [x] 3.1 Estender `SettingsArea` em `src/app/(app)/configuracoes/settings-areas.ts` com `disabled?: boolean` / `comingSoon?: boolean`
- [x] 3.2 Em `src/app/(app)/configuracoes/page.tsx`, derivar o estado congelado dos cards `whatsapp` e `lembretes` a partir de `clientEnv.NEXT_PUBLIC_WHATSAPP_UI_ENABLED` e renderizar `<Card>` não-clicável (sem `<Link>`) com `aria-disabled="true"`, tokens `text-disabled` e `<Badge variant="neutral">Em breve</Badge>`
- [x] 3.3 Estender `Integration` em `src/app/(app)/configuracoes/integracoes/integrations.ts` e aplicar o mesmo congelamento ao card "WhatsApp" em `integracoes/page.tsx`
- [x] 3.4 Confirmar que os demais cards (Locais, Agenda, Transcrição IA, etc.) permanecem navegáveis e inalterados

## 4. Conformidade Design System & acessibilidade

- [x] 4.1 Validar que nenhum estado congelado usa cor `brand`; usar exclusivamente `text-disabled`/`surface-muted` e Badge `neutral`
- [x] 4.2 Verificar contraste WCAG 2.1 AA do texto desabilitado e da tag "Em breve" (light e dark mode)
- [x] 4.3 Verificar navegação por teclado e leitores de tela (`aria-disabled`, ausência de alvo de navegação) nos itens congelados

## 5. Testes

- [ ] 5.1 Unit: `client-schema` coage `"true"`→`true`, `"false"`→`false`, ausente→`false` (default) e rejeita valor inválido
- [ ] 5.2 Unit/UI: `sidebar-nav` renderiza "Caixa de entrada" navegável quando flag ligada e congelada (sem link, `aria-disabled`, tag "Em breve", sem badge de não-lidas) quando desligada
- [ ] 5.3 Unit/UI: página `/configuracoes` renderiza cards "WhatsApp" e "Lembretes" navegáveis (flag on) e congelados (flag off); demais cards sempre navegáveis
- [ ] 5.4 Unit/UI: card "WhatsApp" em `/configuracoes/integracoes` congelado quando flag off
- [ ] 5.5 Verificar que nenhuma rota é bloqueada/redirecionada pela flag (escopo só-UI) — acesso direto a `/caixa-de-entrada` continua respondendo

## 6. Fechamento

- [ ] 6.1 Rodar lint, type-check e a suíte de testes afetada
- [ ] 6.2 Atualizar documentação relevante (se houver runbook/onboarding citando esses pontos de entrada)
- [ ] 6.3 `openspec validate disable-whatsapp-reminders-ui` passando e abrir PR
