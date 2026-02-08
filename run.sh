#!/bin/bash
# Run Maya Code bot with auto-restart on exit (supports /restart command)
cd "$(dirname "$0")"

while true; do
  npx tsx src/index.ts
  echo "Bot exited. Restarting in 1s..."
  sleep 1
done
