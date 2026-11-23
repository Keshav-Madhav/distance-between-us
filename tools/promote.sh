#!/bin/bash
# Promote the current working tree to the PLAYTEST server (port 4417): build into dist-playtest/ and
# (re)start a static preview of it. The playtest server never live-updates — it changes only when this
# runs. The workbench (vite dev on 5417) is untouched.   bash tools/promote.sh
set -e
cd "$(dirname "$0")/.."
npx tsc -p . --noEmit
npx vite build --outDir dist-playtest --emptyOutDir --logLevel warn
echo "$(git rev-parse --short HEAD) $(date '+%Y-%m-%d %H:%M')" > dist-playtest/PLAYTEST_VERSION.txt
pid=$(lsof -t -nP -iTCP:4417 -sTCP:LISTEN 2>/dev/null || true)
[ -n "$pid" ] && kill $pid && sleep 1
nohup npx vite preview --outDir dist-playtest --port 4417 --strictPort > /tmp/dbu-playtest.log 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:4417/ && break; sleep 0.5; done
echo "playtest: http://localhost:4417/  ($(cat dist-playtest/PLAYTEST_VERSION.txt))"
