# Handoff — Links inline nos consentimentos LGPD do signup

**Autor:** ui-ux-designer · **Data:** 2026-07-01
**Para:** agente implementador (fullstack-developer)
**Escopo:** frontend apenas. Sem mudança de schema, Server Action, DB ou middleware.

---

## 1. Objetivo

Na página `/signup`, os três checkboxes de consentimento LGPD exibem texto estático,
sem qualquer link para o conteúdo que o usuário precisa ler antes de aceitar. Isso é uma
falha de UX **e** um risco jurídico: sob a LGPD (art. 8º), o consentimento precisa ser
_informado_; o de dados sensíveis (art. 11 — dados de saúde de pacientes) é o mais crítico.

**Meta:** transformar as palavras-âncora de cada label em links reais para as páginas
legais já existentes, abrindo em **nova aba** para não destruir o estado do formulário
de cadastro (nome, e-mail, senha, CRP já preenchidos).

Abordagem decidida (e por quê): **link inline abrindo em nova aba**, e não modal/sheet.

- Preserva o estado do form (nova aba não navega para fora).
- Reaproveita as páginas legais que já existem e estão publicadas.
- É o padrão que o próprio produto já usa no footer e no cookie-consent.
- Modal só se justificaria com requisito de _scroll-to-accept_, que não existe aqui.

---

## 2. Contexto do código (já mapeado)

### Arquivo a alterar

`src/modules/registration/components/signup-form.tsx` — **único arquivo de implementação.**

- Componente client `SignupForm` renderiza três `<ConsentRow>` (por volta das linhas 500–554).
- `ConsentRow` é um helper local no fim do mesmo arquivo (a partir de ~linha 581).
- Hoje `ConsentRow` recebe `label: string` e o renderiza dentro de um `<Label htmlFor={inputId}>`.

### O que NÃO muda

- **Schema:** `src/modules/registration/lib/signup-input-schema.ts` — os campos
  `acceptedTerms`, `acceptedPrivacy`, `acceptedSensitiveData` são `z.literal(true)`.
  A mudança é 100% apresentacional. Não tocar.
- **Server Action** (`server/sign-up.ts`), serialização de FormData (`'on'`), `coerceCheckbox`,
  hidden `<input>`, `register`, `setValue`, IDs, `aria-describedby` de erro: **tudo intacto.**

### Páginas de destino (já existem, rotas públicas, âncoras funcionam)

- `/termos-de-uso` → `src/app/(public)/termos-de-uso/page.tsx`
- `/politica-de-privacidade` → `src/app/(public)/politica-de-privacidade/page.tsx`
  - Seções com `id` + `scroll-mt-24`. Âncora relevante: `#lgpd` ("5. Seus direitos sob a LGPD").
- Ambas classificadas como `'public'` em `src/middleware.ts:classifyPath()` — acessíveis anonimamente.

---

## 3. Especificação da mudança

### 3.1. Alterar a assinatura do `ConsentRow`

Trocar o tipo do prop `label` de `string` para `ReactNode`. Nenhuma outra prop muda.

```ts
// antes
label: string;
// depois
label: React.ReactNode;
```

Importar `ReactNode` de `react` (ou usar `React.ReactNode`).

### 3.2. Corrigir a associação label ⇄ link (OBRIGATÓRIO — não pular)

Hoje o `<Label htmlFor={inputId}>` envolve o texto inteiro. Se um `<a>` for colocado
**dentro** desse `<label>`, clicar no link também alterna o checkbox — ações que precisam
ser distintas (ler ≠ aceitar), inclusive para teclado e leitor de tela.

Escolha **uma** das duas soluções:

- **(A) Preferida** — tirar o texto de dentro do `<Label>`. Manter o `<Label htmlFor>`
  apenas como alvo clicável mínimo, e renderizar o texto+links em um `<span>`/`<p>` irmão
  associado ao checkbox via `aria-describedby` (ou deixar o `<Label>` conter só o texto puro
  e os links ficarem num parágrafo separado abaixo). O importante: **o `<a>` não pode estar
  dentro do elemento `<label>`**.
- **(B) Alternativa** — manter o link dentro do label, mas adicionar
  `onClick={(e) => e.stopPropagation()}` no `<a>`. Menos limpo; use só se (A) atrapalhar o layout.

> Validação de aceite: após a mudança, clicar na **palavra-link** deve abrir a nova aba
> **sem** marcar/desmarcar o checkbox. Clicar no restante do texto ou no quadradinho deve
> alternar o checkbox normalmente.

### 3.3. Conteúdo dos três consentimentos

Reescrever para "Li e aceito …" com a palavra-âncora como link. A frase deve fazer sentido
mesmo sem o link (bom para leitor de tela):

| Campo                   | Texto                                                              | href                            |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------- |
| `acceptedTerms`         | Li e aceito os **Termos de Uso**                                   | `/termos-de-uso`                |
| `acceptedPrivacy`       | Li e aceito a **Política de Privacidade**                          | `/politica-de-privacidade`      |
| `acceptedSensitiveData` | Autorizo o tratamento dos meus **dados sensíveis conforme a LGPD** | `/politica-de-privacidade#lgpd` |

Apenas o texto em **negrito** vira `<a>`.

### 3.4. Estilo do link (on-token — usar exatamente estes)

Tokens já em uso nas páginas públicas do projeto:

- Cor: `text-brand-600`, hover `hover:text-brand-700`
- Sublinhado: `underline underline-offset-2`
- Atributos: `target="_blank" rel="noopener noreferrer"`
- Foco: herdar `focus-visible` do design system (não sobrescrever)
- Ícone opcional de "abre em nova aba" (`ExternalLink` 14px do lucide-react, `aria-hidden`)
  logo após o texto — sinaliza que a navegação sai do fluxo. Opcional, mas recomendado.

Usar `next/link` (`<Link>`) ou `<a>`? Como abre em nova aba e são páginas estáticas,
`<a href target="_blank">` é suficiente e evita prefetch desnecessário. `<Link>` também
é aceitável. Seguir o que o footer/cookie-consent já usam para consistência
(ver `src/modules/marketing/components/public-footer.tsx`).

---

## 4. Acessibilidade (WCAG) — checklist de aceite

- [ ] **Contraste:** `brand-600` sobre o fundo do card deve passar **4.5:1**. Se ficar
      borderline no medidor, usar `brand-700`. (Validar no Hubrity Design System / Figma.)
- [ ] **Distinção não só por cor:** o `underline` garante que o link seja perceptível sem
      depender de cor (WCAG 1.4.1).
- [ ] **Teclado:** o link é tabável e ativável por Enter; o foco é visível.
- [ ] **Leitor de tela:** o texto do label continua coerente; o `aria-describedby` de erro
      existente continua funcionando; o link tem nome acessível claro ("Termos de Uso" etc.).
- [ ] **Alvo de toque:** link inline < 44px de altura é aceitável (exceção WCAG 2.5.8 para
      texto inline), mas manter `leading-snug`/espaçamento para não conflitar com o clique do checkbox.
- [ ] **Separação de ações:** clicar no link **não** marca o checkbox (ver 3.2).

---

## 5. Testes

- **Unit** (`src/__tests__/unit/modules/registration/…`): adicionar/ajustar um teste do
  `signup-form` verificando que os três labels renderizam um link com o `href` correto
  (`/termos-de-uso`, `/politica-de-privacidade`, `/politica-de-privacidade#lgpd`) e
  `target="_blank"` + `rel="noopener noreferrer"`.
- **Não** alterar `signup-input-schema.test.ts` nem `sign-up.int.test.ts` — a lógica de
  validação/aceite não muda.
- **Regressão:** confirmar que o teste existente de submit (aceitar os três → sucesso;
  deixar um desmarcado → erro) continua passando sem alteração.
- `src/__tests__/integration/marketing/legal-pages.int.test.ts` já cobre as páginas de destino.

---

## 6. Fora de escopo (levantar, não implementar aqui)

A política de privacidade **não tem seção dedicada a "tratamento de dados sensíveis"** —
só a seção genérica `#lgpd`. Como dados de saúde de pacientes são o núcleo do produto e o
art. 11 da LGPD tem regras próprias, recomenda-se **adicionar uma seção `#dados-sensiveis`**
(finalidade, base legal, retenção) e reapontar o link do terceiro checkbox para ela.
É um **gap de conteúdo** que precisa passar por validação jurídica — não fazer nesta entrega.
Por enquanto, o terceiro checkbox aponta para `#lgpd`.

---

## 7. Definition of Done

1. `ConsentRow.label` aceita `ReactNode`.
2. Os três consentimentos exibem links on-token para as páginas legais, abrindo em nova aba.
3. Clicar no link não altera o checkbox; clicar no checkbox/texto alterna normalmente.
4. Contraste do link valida em AA (≥ 4.5:1).
5. Teste unitário de renderização dos links adicionado; suíte existente verde.
6. `lint` + `type-check` passam (pré-commit Husky sem `--no-verify`).
