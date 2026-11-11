#!/bin/sh
# Start PromptGate Video and open it in your browser (Linux, or macOS from a terminal).
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js 18+ is required: https://nodejs.org"; exit 1; }
exec node server.js --open
