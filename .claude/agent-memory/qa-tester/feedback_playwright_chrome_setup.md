---
name: Playwright Chrome setup in devcontainer
description: O MCP Playwright procura Chrome em /opt/google/chrome/chrome mas o devcontainer tem apenas Chromium instalado em /home/node/.cache/ms-playwright/chromium-*/chrome-linux64/chrome
type: feedback
---

O MCP Playwright (via `@playwright/mcp@latest`) tenta inicializar o browser em `/opt/google/chrome/chrome`. No devcontainer, apenas o Chromium do Playwright está instalado.

**Solução**: Criar symlink manual com sudo:
```bash
sudo mkdir -p /opt/google/chrome
sudo ln -sf /home/node/.cache/ms-playwright/chromium-<VERSION>/chrome-linux64/chrome /opt/google/chrome/chrome
```

Verificar a versão atual com: `npx playwright install --list`

**Why:** O MCP usa o canal "chrome" por padrão; o devcontainer não instala o Google Chrome, apenas o Chromium do Playwright.
**How to apply:** Se `mcp__playwright__browser_navigate` retornar "Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome", executar os comandos acima antes de prosseguir com os testes.
