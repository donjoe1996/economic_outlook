#!/usr/bin/env bash
# macOS / Linux: ./start.sh
# Creates .venv the first time, and (re)installs packages whenever
# requirements.txt changed since the last install.
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
if ! cmp -s requirements.txt .venv/requirements.installed; then
  .venv/bin/pip install -r requirements.txt
  cp requirements.txt .venv/requirements.installed
fi
exec .venv/bin/python run.py "$@"
