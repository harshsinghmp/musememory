#!/usr/bin/env bash
set -euo pipefail

echo "🧠 Installing Muse Memory (musememory)..."

# Source repository target
REPO_URL="git+https://github.com/harshsinghmp/musememory.git"

# Check prerequisites
if command -v bun >/dev/null 2>&1; then
  echo "✓ Found Bun runtime"
  INSTALL_CMD="bun add -g $REPO_URL"
elif command -v npm >/dev/null 2>&1; then
  echo "✓ Found Node/NPM runtime"
  INSTALL_CMD="npm install -g $REPO_URL"
else
  echo "❌ Error: Neither Bun nor Node/NPM was found."
  echo "Please install Bun (https://bun.sh) or Node.js (https://nodejs.org) and rerun."
  exit 1
fi

echo "Running: $INSTALL_CMD"
eval "$INSTALL_CMD"

echo ""
echo "🎉 Muse Memory installed successfully!"
echo "You can now use the concise 'memory' command (or 'musememory'):"
echo "  memory --help"
echo "  memory detect"
echo "  memory migrate --global"
echo "  memory connect --all"
