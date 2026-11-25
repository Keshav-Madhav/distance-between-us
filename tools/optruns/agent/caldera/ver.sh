#!/bin/bash
# usage: ver.sh <inputs.json>  bench-verify, print compact
cd ~/Repositories/distance-between-us
while :; do l=$(sysctl -n vm.loadavg | awk '{print int($2)}'); [ $l -le 90 ] && break; echo "load $l, waiting"; sleep 60; done
D=tools/optruns/agent/caldera
node tools/agentrun.mjs run caldera $D/$1 > $D/v-$1
python3 -c "
import json;r=json.load(open('$D/v-$1'))
print('$1',r.get('human'),r['counted'],r['time'],'top',r['topMach'],'missed',[g['gate'] for g in r['gates'] if g['missed']],'ev',r['events'][:5],'trLat',max(abs(t[2]) for t in r['trace']))"
