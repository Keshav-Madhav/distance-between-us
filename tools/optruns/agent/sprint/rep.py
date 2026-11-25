import sys,json
for l in sys.stdin:
    i=l.find('{"polyFix')
    if i<0: print(l[:300]); continue
    d=json.loads(l[i:]); print(l[:2], {k:d.get(k) for k in ['polyFix','time','missed','pads','maxLat','maxLat30','top','nevs','dropped']}, d.get('evs'))
