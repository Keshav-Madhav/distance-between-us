import json,sys
r=json.load(open(sys.argv[1]))
print({k:r[k] for k in ['counted','time','passed','missedGates','topMach','steps']})
print(' '.join(f"{g['gate']}:{g['t']}/{g['mach']}{'M' if g['missed'] else ''}" for g in r['gates']))
print([e for e in r['events'] if e['what']!='airborne'])
print('air', [e['t'] for e in r['events'] if e['what']=='airborne'])
if len(sys.argv)>2: print(r['trace'])
