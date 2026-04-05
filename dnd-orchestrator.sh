#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Compilando..."
npm run tauri build -- --no-bundle 2>&1 | tail -5

WEBKIT_DISABLE_COMPOSITING_MODE=1 "$SCRIPT_DIR/src-tauri/target/release/dnd-orchestrator"
