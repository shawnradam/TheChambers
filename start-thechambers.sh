#!/usr/bin/env sh
# TheChambers launcher for macOS and Linux.
#
#   ./start-thechambers.sh                 # bind the Tailscale address on port 3002
#   ./start-thechambers.sh --local         # loopback only
#   ./start-thechambers.sh --port 3003     # another port
#   ./start-thechambers.sh --workspace ~/code
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not on PATH. TheChambers needs Node 22 or newer." >&2
  exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node 22 or newer is required (found $(node -v))." >&2
  exit 1
fi

exec node "$DIR/bin/thechambers.mjs" "$@"
