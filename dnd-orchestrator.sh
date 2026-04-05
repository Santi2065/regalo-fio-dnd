#!/bin/bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 "$(dirname "$0")/src-tauri/target/release/dnd-orchestrator"
