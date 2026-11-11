#!/bin/bash
# Double-click (macOS) to start PromptGate Video and open it in your browser.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js 18+ is required: https://nodejs.org"; read -r; exit 1; }
node server.js --open
