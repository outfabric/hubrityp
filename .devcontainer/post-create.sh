#!/usr/bin/env bash
# Executa UMA VEZ na criação do container.
set -euo pipefail

echo "==> Instalando Xvfb (display virtual para playwright MCP do qa-tester)..."
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends xvfb

echo "==> Instalando Claude Code CLI..."
npm install -g @anthropic-ai/claude-code@latest

echo "==> Registrando plugins do Claude Code para o container..."
# installed_plugins.json (montado do host) tem installPath e projectPath com
# caminhos absolutos do host (/home/antonio/...). No container o home é
# /home/node/ e o projeto está em /workspaces/hubrityp, então o Claude Code
# não encontra o plugin. Este comando adiciona um novo entry com os caminhos
# corretos do container — os dois entries coexistem sem conflito.
claude plugins install typescript-lsp@claude-plugins-official

echo "==> Instalando openspec CLI..."
# @fission-ai/openspec é usado pelo /dev-cycle (openspec status, openspec list).
# Instalado globalmente no host via nvm — precisa ser reinstalado no container.
npm install -g @fission-ai/openspec@latest

echo "==> Verificando GitHub CLI..."
if command -v gh &> /dev/null; then
  echo "    gh encontrado em $(which gh)"
  if gh auth status &> /dev/null; then
    echo "    gh autenticado ✓"
  else
    echo "    ⚠ gh NÃO autenticado. Execute 'gh auth login' manualmente."
  fi
else
  echo "    ⚠ gh NÃO encontrado. O feature github-cli pode ter falhado no build."
  echo "    Tentando instalar via apt..."
  (type -p wget >/dev/null || (sudo apt update && sudo apt-get install wget -y)) \
    && sudo mkdir -p -m 755 /etc/apt/keyrings \
    && out=$(mktemp) && wget -nv -O"$out" https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    && cat "$out" | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
    && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && sudo apt update \
    && sudo apt install gh -y
fi

echo "==> Instalando dependências do projeto..."
npm install --no-audit --no-fund

echo "==> Instalando Playwright + Chromium..."
# playwright MCP (qa-tester) usa Chromium com DISPLAY=:99 (Xvfb).
# Playwright seeded e2e também usa este Chromium.
npx playwright install chromium --with-deps

echo ""
echo "Setup concluído. Ao abrir um terminal:"
echo "  npm run dev       # inicia Next.js na porta 3000"
echo ""
echo "Xvfb sobe automaticamente a cada restart (post-start.sh)."
echo "Supabase é gerenciado pelo /dev-cycle ou iniciado manualmente com npm run supabase:start."
