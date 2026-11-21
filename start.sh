#!/usr/bin/env bash
# macOS / Linux: ./start.sh   (first run creates .venv and installs packages)
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi
exec .venv/bin/python run.py "$@"
