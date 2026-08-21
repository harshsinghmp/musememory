#!/usr/bin/env bash
set -euo pipefail

echo "🧠 Installing Muse Memory (musememory)..."

# Check prerequisites
if command -v bun >/dev/null 2>&1; then
  echo "✓ Found Bun runtime"
  INSTALL_CMD="bun add -g musememory"
elif command -v npm >/dev/null 2>&1; then
  echo "✓ Found Node/NPM runtime"
  INSTALL_CMD="npm install -g musememory"
else
  echo "❌ Error: Neither Bun nor Node/NPM was found."
  echo "Please install Bun (https://bun.sh) or Node.js (https://nodejs.org) and rerun."
  exit 1
fi

echo "Running: $INSTALL_CMD"
eval "$INSTALL_CMD"

echo "🎉 Muse Memory installed successfully!"
echo "You can now use the concise 'memory' command (or 'musememory'):"
echo "  memory --help"
echo "  memory search 'your query'"
