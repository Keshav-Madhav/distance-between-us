#!/bin/bash
# Solve every race course in both modes, one after another (one browser at a time; solve.mjs waits while the
# 1-minute load is above 90). Resumable: a course+mode whose runs/<course>-<mode>.json already exists is skipped.
#
#   tools/optruns/solver/all.sh [courses…]
#   BUDGET=600      seconds per solve (default 600)
#   MODES="rogue ideal"
#   FORCE=1         re-solve everything (a new run replaces the saved one only if the bench says it is faster)
#   RETRY_INVALID=1 re-solve only the ones whose saved result is not valid
# Log: tools/optruns/solver/runs/all.log (one JSON summary line per solve); table: node tools/optruns/solver/table.mjs
cd "$(dirname "$0")/../../.." || exit 1
DIR=tools/optruns/solver
BUDGET=${BUDGET:-600}
MODES=${MODES:-"rogue ideal"}
# course ids from src/course.ts COURSES (orbit is the star system, not a ground race)
ALL=$(grep -E "^  id: '" src/course.ts | sed -E "s/^  id: '([^']+)'.*/\1/" | grep -v '^orbit$')
COURSES=${@:-$ALL}
mkdir -p $DIR/runs
for c in $COURSES; do
  for m in $MODES; do
    f=$DIR/runs/$c-$m.json
    if [ -f "$f" ] && [ -z "$FORCE" ]; then
      if [ -n "$RETRY_INVALID" ] && ! grep -q '"valid":true' "$f"; then :; else echo "skip $c $m (done)"; continue; fi
    fi
    echo "=== $c $m $(date '+%H:%M:%S')"
    EXTRA=""; [ -n "$FORCE" ] && EXTRA="--force"
    line=$(node $DIR/solve.mjs "$c" "$m" "$BUDGET" $EXTRA 2>>$DIR/runs/$c-$m.log | tail -1)
    [ -z "$line" ] && line="{\"course\":\"$c\",\"mode\":\"$m\",\"valid\":false,\"error\":\"solver crashed (see runs/$c-$m.log)\"}"
    echo "$line" | tee -a $DIR/runs/all.log
  done
done
