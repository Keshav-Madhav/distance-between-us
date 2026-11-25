#!/bin/bash
# usage: sw.sh <list.json>   (runs the sweep with the caldera ctl copy, prints compact lines)
cd ~/Repositories/distance-between-us
while :; do l=$(sysctl -n vm.loadavg | awk '{print int($2)}'); [ $l -le 90 ] && break; echo "load $l, waiting"; sleep 60; done
node tools/optruns/agent/caldera/ctl.mjs caldera tools/optruns/agent/caldera/$1 tools/optruns/agent/caldera/$1 2>&1 | python3 -c "
import sys,json,re
for line in sys.stdin:
  m=re.match(r'(\d+) (\{.*?\}) (\{.*\})$',line.strip())
  if not m: print(line.strip()[:300]); continue
  r=json.loads(m.group(3))
  if 'error' in r: print(m.group(1),'ERR',r['error'][:120]); continue
  print(m.group(1),r['time'],'miss',r['missed'],'pads',r['pads'],'lat',r['maxLat'],r['maxLat30'],'top',r['top'],'ev',r['nevs'],r.get('evs',[])[:2])
"
