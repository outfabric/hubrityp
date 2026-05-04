#!/usr/bin/env bash
# Executa EM CADA INÍCIO do container (criação e restarts).
set -euo pipefail

# ── Display virtual ────────────────────────────────────────────────────────────
# Playwright MCP (qa-tester) e os testes seeded e2e usam este display.
# Se já estiver rodando, não faz nada.
if ! pgrep -x Xvfb > /dev/null; then
  echo "==> Iniciando Xvfb em :99..."
  # /tmp/.X11-unix deve existir com sticky bit antes do Xvfb iniciar.
  # O Xvfb roda como 'node' (não root) e não consegue criar o diretório —
  # sem ele o socket não é criado e DISPLAY=:99 fica inacessível ao Playwright.
  sudo mkdir -p /tmp/.X11-unix
  sudo chmod 1777 /tmp/.X11-unix
  Xvfb :99 -screen 0 1280x900x24 -ac +extension GLX +render -noreset &
  disown
  sleep 1
fi

echo ""
echo "Container pronto."
echo ""
echo "O Supabase NÃO sobe automaticamente — lifecycle gerenciado pelo /dev-cycle:"
echo "  - Step 3a (seeded e2e): porta 54321 precisa estar LIVRE para o mock GoTrue."
echo "  - Step 5a (QA): dev-cycle sobe o Supabase se necessário."
echo ""
echo "Para desenvolvimento manual com Supabase real:"
echo "  npm run supabase:start"
echo "  npm run dev"
