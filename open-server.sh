#!/usr/bin/env bash
# Optional: run OSR Desk from a local web address instead of double-clicking the HTML.
# (Some hardened browser setups block storage on file:// — this sidesteps that.)
cd "$(dirname "$0")"
PORT="${1:-8600}"
echo "OSR Desk → http://localhost:$PORT   (Ctrl+C to stop)"
( sleep 1; case "$(uname)" in Darwin) open "http://localhost:$PORT";; *) xdg-open "http://localhost:$PORT" ;; esac ) 2>/dev/null &
python3 -m http.server "$PORT" --bind 0.0.0.0
