#!/usr/bin/env bash
# Executa UMA VEZ na criação do container.
set -euo pipefail

echo "==> Instalando Xvfb (display virtual para playwright MCP do qa-tester)..."
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends xvfb

echo "==> Instalando Claude Code CLI..."
npm install -g @anthropic-ai/claude-code@latest

echo "==> Instalando openspec CLI..."
# @fission-ai/openspec é usado pelo /dev-cycle (openspec status, openspec list).
# Instalado globalmente no host via nvm — precisa ser reinstalado no container.
npm install -g @fission-ai/openspec

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
