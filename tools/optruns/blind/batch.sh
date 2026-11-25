#!/bin/bash
# Solve + judge every course (one browser at a time). Usage: batch.sh [opts-json] [courses…]
cd "$(dirname "$0")/../../.."
OPT=${1:-'{"plainToo":1}'}; shift
COURSES=${@:-"sprint dry-river drag circuit oval canyon frostline icefall whiteout icecave caldera faultline obsidian magma greenway riverrun timberline whitewater mistriver understory"}
for c in $COURSES; do
  node tools/optruns/blind/solve.mjs $c "$OPT" && node tools/optruns/blind/judge.mjs $c tools/optruns/blind/$c.cand.json
done
