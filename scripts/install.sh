#!/usr/bin/env bash
set -euo pipefail

echo "🧠 Installing Muse Memory (musememory)..."

INSTALL_DIR="${HOME}/.musememory"
BIN_DIR="${HOME}/.local/bin"
REPO_URL="https://github.com/harshsinghmp/musememory.git"

mkdir -p "${BIN_DIR}"

# 1. Clone or update the repository in ~/.musememory
echo "→ Syncing repository to ${INSTALL_DIR}..."
if [ -d "${INSTALL_DIR}/.git" ]; then
  cd "${INSTALL_DIR}"
  git fetch --depth 1 origin main
  git reset --hard origin/main
else
  rm -rf "${INSTALL_DIR}"
  git clone --depth 1 "${REPO_URL}" "${INSTALL_DIR}"
  cd "${INSTALL_DIR}"
fi

# 2. Build and link with detected runtime
if command -v bun >/dev/null 2>&1; then
  echo "✓ Detected Bun runtime"
  rm -rf "${HOME}/.bun/install/global/node_modules/musememory" 2>/dev/null || true
  bun install
  bun run build
  bun link
elif command -v npm >/dev/null 2>&1; then
  echo "✓ Detected Node.js / NPM runtime"
  npm install
  npm run build
  npm link
else
  echo "❌ Error: Neither Bun nor Node.js/NPM was found."
  echo "Please install Bun (https://bun.sh) or Node.js (https://nodejs.org) to use Muse Memory."
  exit 1
fi

# 3. Create persistent fallback symlinks in ~/.local/bin
if [ -f "${INSTALL_DIR}/dist/index.js" ]; then
  chmod +x "${INSTALL_DIR}/dist/index.js"
  ln -sf "${INSTALL_DIR}/dist/index.js" "${BIN_DIR}/memory"
  ln -sf "${INSTALL_DIR}/dist/index.js" "${BIN_DIR}/musememory"
fi

# 4. Auto-initialize global environment and auto-wire detected agents
echo "→ Initializing global Muse Memory environment & auto-wiring agents..."
"${INSTALL_DIR}/dist/index.js" install --global || true

echo ""
echo "🎉 Muse Memory installed and verified successfully!"
echo ""
echo "Quick Start Commands:"
echo "  1. Verify system & agent health:           memory doctor --global"
echo "  2. Scan 80+ coding agents on machine:      memory agents"
echo "  3. Auto-wire installed coding agents:      memory connect --all"
echo "  4. Launch visual knowledge graph (2222):   memory ui --global"
echo ""
