# Racing line: min-curvature smoothing inside the canyon floor (walls at half(u)), optional gate windows.
import json,math,sys
d=json.load(open('course.json'))
px,pz=d['px'],d['pz'];n=len(px);S=d['startI'];F=d['finishI']
margin=float(sys.argv[1]); gatew=float(sys.argv[2]); out=sys.argv[3]
finw=float(sys.argv[4]) if len(sys.argv)>4 else 200
def loop(u):
    a=2*math.pi*u; r=10500+2600*math.cos(2*a+0.3)+700*math.sin(5*a+1.0)+260*math.sin(11*a+2.0)
    return r*math.sin(a), r*math.cos(a)-10500
def half(u):
    a=u*math.pi*2;return 1320+240*math.sin(a*3+1.1)+130*math.sin(a*11+2.3)+60*math.sin(a*23+0.4)
N=40000;L=[loop(i/N) for i in range(N)]
i0=max(1,S-40); i1=min(n-2,F+60)
idx=list(range(i0,i1+1))
# normals (right: (tz,-tx))
T=[];H=[]
ui=None
for i in idx:
    tx=px[i+1]-px[i-1];tz=pz[i+1]-pz[i-1];l=math.hypot(tx,tz);tx/=l;tz/=l;T.append((tx,tz))
    rng=range(0,N,10) if ui is None else [(ui+k)%N for k in range(-400,400)]
    best=1e18
    for j in rng:
        dd=(L[j][0]-px[i])**2+(L[j][1]-pz[i])**2
        if dd<best:best=dd;bj=j
    ui=bj;H.append(half(ui/N))
lo=[-(h-margin) for h in H];hi=[h-margin for h in H]
gi=[c['i'] for c in d['cps']]
for k,g in enumerate(gi):
    j=g-i0
    w=finw if k==len(gi)-1 else gatew
    if w>0:
        for jj in range(j-1,j+2):
            lo[jj]=max(lo[jj],-w);hi[jj]=min(hi[jj],w)
# mounds: keep offsets away (mound lateral offset o -> forbid band)
M=d['mounds']
for m in range(0,len(M),4):
    mx,mz,mh,mr=M[m:m+4]
    for j,i in enumerate(idx):
        tx,tz=T[j];dx=mx-px[i];dz=mz-pz[i]
        along=dx*tx+dz*tz
        if abs(along)<mr+150:
            o=dx*tz-dz*tx  # lateral of mound
            r=mr+120
            # choose side away: forbid [o-r,o+r]; pick the side with more room toward 0
            if o>=0: hi[j]=min(hi[j],o-r)
            else: lo[j]=max(lo[j],o+r)
o=[0.0]*len(idx)
P=lambda j:(px[idx[j]]+T[j][1]*o[j], pz[idx[j]]-T[j][0]*o[j])
# minimise sum of squared second differences of the 2D points, projecting each point's offset
for it in range(6000):
    for j in range(2,len(idx)-2):
        # target position: 4-point smoothing (min |d2|^2): x_j = (4(x_{j-1}+x_{j+1}) - (x_{j-2}+x_{j+2}))/6
        a=[P(j-2),P(j-1),P(j+1),P(j+2)]
        tx_=(4*(a[1][0]+a[2][0])-(a[0][0]+a[3][0]))/6
        tz_=(4*(a[1][1]+a[2][1])-(a[0][1]+a[3][1]))/6
        i=idx[j];tx,tz=T[j]
        oo=(tx_-px[i])*tz-(tz_-pz[i])*tx
        o[j]=min(hi[j],max(lo[j],o[j]+1.0*(oo-o[j])))
pts=[P(j) for j in range(len(idx))]
# radius along the line
R=[]
for j in range(len(pts)):
    a=pts[max(0,j-3)];b=pts[j];c=pts[min(len(pts)-1,j+3)]
    h1=math.atan2(b[0]-a[0],b[1]-a[1]);h2=math.atan2(c[0]-b[0],c[1]-b[1])
    dh=(h2-h1+math.pi)%(2*math.pi)-math.pi
    ds=math.hypot(b[0]-a[0],b[1]-a[1])+math.hypot(c[0]-b[0],c[1]-b[1])
    R.append(ds/2/max(1e-6,abs(dh)))
length=sum(math.hypot(pts[j+1][0]-pts[j][0],pts[j+1][1]-pts[j][1]) for j in range(len(pts)-1))
json.dump({'i0':i0,'x':[p[0] for p in pts],'z':[p[1] for p in pts],'R':R,'o':o,'H':H},open(out,'w'))
Rs=sorted(R); print('len',round(length),'minR',[round(r) for r in Rs[:5]], 'pctl10',round(Rs[len(Rs)//10]))
for j in range(0,len(idx),20): print(idx[j],round(o[j]),round(H[j]),round(R[j]))
