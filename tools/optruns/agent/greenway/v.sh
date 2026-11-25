#!/bin/bash
# verify an inputs file in the bench; prints the summary
cd ~/Repositories/distance-between-us
node tools/agentrun.mjs run greenway "$1" > /private/tmp/claude-502/-Users-keshavmadhav-verbaflo-Repositories-portfolio-website/e18b0817-8173-4e62-8348-b75848d93f42/scratchpad/v.json
node -e "const r=JSON.parse(require('fs').readFileSync('/private/tmp/claude-502/-Users-keshavmadhav-verbaflo-Repositories-portfolio-website/e18b0817-8173-4e62-8348-b75848d93f42/scratchpad/v.json','utf8')); console.log(JSON.stringify({counted:r.counted,time:r.time,missed:r.missedGates,top:r.topMach,events:r.events.filter(e=>e.what!='airborne'),air:r.events.filter(e=>e.what=='airborne').length, maxLat:Math.max(...r.trace.map(t=>Math.abs(t[2])))}))"
