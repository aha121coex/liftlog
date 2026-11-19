#!/usr/bin/env bash
# Local verification requires localhost sockets and the inherited Cloud proxy.
set -euo pipefail
cd /workspace/liftlog
python3 drawdown/scripts/browser-smoke.py
# Node 24 in the Cloud workspace can use the inherited proxy explicitly.
# GitHub-hosted Node 22 runners do not need this local-only flag.
node --use-env-proxy drawdown/scripts/update-data.mjs --output dist/drawdown/data/monitor.json
