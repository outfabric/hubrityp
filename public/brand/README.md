# Hubrity — Assets de Marca

Identidade visual completa (manual editável): **Figma** — arquivo `4O3POARuvEYI1BCrxbOFg2`
(`Hubrity — Marca & Identidade Visual (Escuta)`).

## Arquivos

| Arquivo                        | Uso                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `simbolo.svg`                  | Símbolo "H" colorido (sálvia + azul + teal). Favicon, avatar, usos reduzidos.  |
| `simbolo-branco.svg`           | Símbolo em branco — sobre fundos escuros/coloridos.                            |
| `simbolo-mono.svg`             | Símbolo em tinta (#21261F) — monocromático, impressão 1 cor.                   |
| `lockup-horizontal.svg`        | Lockup horizontal (símbolo + "hubrity"). Header do site/app. Texto vetorizado. |
| `lockup-horizontal-branco.svg` | Lockup horizontal em branco — headers escuros.                                 |
| `lockup-vertical.svg`          | Lockup vertical (símbolo acima do wordmark). Usos centrados.                   |
| `og-image.png`                 | Card social 1200×630 (compartilhamento WhatsApp/redes).                        |

## Já integrados ao Next.js (App Router, auto-detectados)

- `src/app/icon.svg` → favicon (Next gera os tamanhos automaticamente).
- `src/app/apple-icon.png` → ícone iOS (360×360, H branco sobre sálvia).
- `src/app/opengraph-image.png` e `src/app/twitter-image.png` → preview social automático.

## Regras rápidas

- **Espaço livre:** mantenha ao redor da logo uma margem ≥ à altura da travessa (o elo).
- **Tamanho mínimo:** símbolo 16px; lockup horizontal 120px de largura. Abaixo disso, só o símbolo.
- **Wordmark:** Nunito SemiBold, minúsculas. (UI do produto usa Inter.)
- **Não** gire, distorça, recolora ou aplique sombra. Veja a página "Aplicações" no Figma.

## Cores

Sálvia `#587355` · Azul-sereno `#5B7A93` · Teal (encontro) `#3F6F63` · Tinta `#21261F`
Escala completa e tokens: design system Sálvia (`src/app/globals.css`).
