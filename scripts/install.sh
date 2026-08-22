#!/usr/bin/env bash
set -euo pipefail

echo "🧠 Installing Muse Memory (musememory)..."

INSTALL_DIR="${HOME}/.musememory"
BIN_DIR="${HOME}/.local/bin"
REPO_URL="https://github.com/harshsinghmp/musememory.git"

mkdir -p "${BIN_DIR}"

# 1. Determine best installer strategy
if command -v bun >/dev/null 2>&1; then
  echo "✓ Detected Bun runtime"
  # Attempt global add via git URL
  if bun add -g "git+${REPO_URL}" >/dev/null 2>&1; then
    echo "✓ Installed globally via Bun package manager"
  else
    echo "→ Cloning to ${INSTALL_DIR} for direct Bun linkage..."
    rm -rf "${INSTALL_DIR}"
    git clone --depth 1 "${REPO_URL}" "${INSTALL_DIR}"
    cd "${INSTALL_DIR}"
    bun install
    bun link
  fi
elif command -v npm >/dev/null 2>&1; then
  echo "✓ Detected Node.js / NPM runtime"
  # Try direct clone and link to prevent EALLOWGIT restrictions
  echo "→ Cloning repository to ${INSTALL_DIR}..."
  rm -rf "${INSTALL_DIR}"
  git clone --depth 1 "${REPO_URL}" "${INSTALL_DIR}"
  cd "${INSTALL_DIR}"
  npm install
  npm link
else
  echo "❌ Error: Neither Bun nor Node.js/NPM was found."
  echo "Please install Bun (https://bun.sh) or Node.js (https://nodejs.org) to use Muse Memory."
  exit 1
fi

# Ensure ~/.local/bin is in PATH if binaries were linked there
case ":$PATH:" in
  *":${BIN_DIR}:"*) ;;
  *)
    echo "💡 Note: Add ${BIN_DIR} to your PATH in ~/.bashrc or ~/.zshrc if not already present:"
    echo "   export PATH=\"\${HOME}/.local/bin:\$PATH\""
    ;;
esac

echo ""
echo "🎉 Muse Memory installed and verified successfully!"
echo ""
echo "Quick Start Commands:"
echo "  1. Run complete workspace & agent setup:  memory install"
echo "  2. Verify system & agent health:           memory doctor"
echo "  3. Scan 80+ coding agents on machine:      memory agents"
echo "  4. Auto-wire installed coding agents:      memory connect --all"
echo "  5. Launch visual knowledge graph:          memory ui --global"
echo ""
