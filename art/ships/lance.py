# LANCE — from concept art/ships/concepts/lance-1.png. A long needle-nosed fuselage with a probe, a
# long canopy, thin swept wings, a tall raked tail fin; two engines slung under the rear fuselage with
# exposed machinery and a pipe-run spine on top ahead of the main nozzle. Game frame: x right, y up,
# z forward.
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from lib import *
from lib import _mono_cubic

reset()
M = {k: mat(k, *v) for k, v in {
    'paint': ((0.86, 0.87, 0.88), 0.1, 0.35), 'trim': ((0.95, 0.42, 0.1), 0.2, 0.4),
    'carbon': ((0.16, 0.17, 0.19), 0.4, 0.5), 'metal': ((0.62, 0.64, 0.68), 1.0, 0.3),
    'glass': ((0.06, 0.08, 0.11), 0.3, 0.08), 'gun': ((0.23, 0.25, 0.28), 0.8, 0.34),
    'brass': ((0.72, 0.53, 0.23), 0.9, 0.3)}.items()}
M['glow'] = mat('glow', (0.4, 0.85, 1.0), 0, 0.3, emit=(0.4, 0.85, 1.0))
M['hot'] = mat('hot', (1.0, 0.55, 0.2), 0, 0.3, emit=(1.0, 0.55, 0.2))

NZ = -3.9
FY = 1.0                          # fuselage axis height
EX, EY, ER = 0.62, 0.42, 0.42     # under-slung engines
right = []

# ── Fuselage: a long needle with a flattened chined section, thickening aft.
HEX = [(1.0, 0.0), (0.8, 0.55), (0.45, 0.93), (0.0, 1.0), (-0.45, 0.93), (-0.8, 0.55), (-1.0, 0.0), (-0.8, -0.55), (-0.45, -0.93), (0.0, -1.0), (0.45, -0.93), (0.8, -0.55)]
FUS = [(6.6, 0, FY - 0.06, 0.03, 0.02, 0.02), (5.0, 0, FY - 0.03, 0.22, 0.1, 0.1), (2.6, 0, FY, 0.5, 0.28, 0.26), (0.4, 0, FY, 0.62, 0.42, 0.34),
       (-1.6, 0, FY, 0.62, 0.44, 0.36), (-3.0, 0, FY, 0.5, 0.4, 0.32), (-3.5, 0, FY, 0.36, 0.32, 0.26)]
poly_loft('fuselage', FUS, HEX, 60, M['paint'], angle=40)
_zs = sorted(f[0] for f in FUS); _top = _mono_cubic(_zs, [next(f[2] + f[4] for f in FUS if f[0] == z) for z in _zs])
_hw = _mono_cubic(_zs, [next(f[3] for f in FUS if f[0] == z) for z in _zs])
# Probe with two collars.
cyl('probe', 0.025, 1.3, (0, FY - 0.06, 7.2), 'z', 10, M['metal'], r2=0.005)
for z in (6.75, 7.0):
    cyl('probe_collar', 0.045, 0.06, (0, FY - 0.06, z), 'z', 12, M['gun'])
# Long canopy set into the spine.
smooth_loft('canopy_sill', [(2.5, 0, _top(2.2) - 0.08, 0.06, 0.05, 0.02, 2.0), (1.9, 0, _top(1.8) - 0.08, 0.34, 0.07, 0.02, 2.4), (0.9, 0, _top(0.9) - 0.08, 0.44, 0.08, 0.02, 2.4), (0.0, 0, _top(0.0) - 0.08, 0.38, 0.07, 0.02, 2.4), (-0.6, 0, _top(-0.4) - 0.08, 0.06, 0.05, 0.02, 2.0)], 24, 20, M['gun'])
smooth_loft('canopy', [(2.4, 0, _top(2.2) - 0.06, 0.04, 0.03, 0.02, 2.0), (1.9, 0, _top(1.8) - 0.06, 0.28, 0.16, 0.02, 2.3), (0.9, 0, _top(0.9) - 0.06, 0.38, 0.34, 0.02, 2.3), (0.0, 0, _top(0.0) - 0.06, 0.32, 0.24, 0.02, 2.3), (-0.5, 0, _top(-0.4) - 0.06, 0.04, 0.03, 0.02, 2.0)], 28, 22, M['glass'])
for f in (1.7, 0.6):
    k = 0.85 if f > 1 else 1.0
    tube('canopy_bow', [(0.36 * k * math.cos(t), _top(f) - 0.06 + 0.25 * k * math.sin(t), f) for t in [i * math.pi / 10 for i in range(11)]], 0.016, M['gun'])
pilot(M, 0, _top(0.6) + 0.11, 0.55, 0.13)
# Livery: a sweeping orange line and a dark band along each flank.
poly_loft('top_stripe', [(z, 0, _top(z) + 0.004, 0.06, 0.01, 0.01) for z in (4.8, 3.2, 2.6)], [(1, 0), (0.9, 1), (-0.9, 1), (-1, 0), (-0.9, -1), (0.9, -1)], 24, M['trim'], cap1=True, angle=80)
poly_loft('top_stripe2', [(z, 0, _top(z) + 0.004, 0.06, 0.01, 0.01) for z in (-0.6, -1.4)], [(1, 0), (0.9, 1), (-0.9, 1), (-1, 0), (-0.9, -1), (0.9, -1)], 12, M['trim'], cap1=True, angle=80)

# ── Wings: thin, swept, mid-fuselage, with orange edge lines.
for sx in (1, -1):
    # A swept airfoil loft from root to tip (sections along x; chord along z, thickness along y).
    root, tip = (0.5, 0.5, 2.6, 0.06), (3.0, -1.3, 0.75, 0.025)   # (x, leading-edge z, chord, half-thickness)
    rings = []
    for k in range(9):
        u = k / 8; x = root[0] + (tip[0] - root[0]) * u; le = root[1] + (tip[1] - root[1]) * u
        ch = root[2] + (tip[2] - root[2]) * u; th = root[3] + (tip[3] - root[3]) * u
        rings.append((x, le, ch, th))
    bm = bmesh.new(); loops = []; N = 20
    for (x, le, ch, th) in rings:
        loop = []
        for j in range(N):
            t = 2 * math.pi * j / N; c = 0.5 - 0.5 * math.cos(t)           # 0 at LE … 1 at TE
            yy = th * (1.0 - c) ** 0.6 * (c * 4) ** 0.5 * math.copysign(1, math.sin(t)) * 0.9
            loop.append(bm.verts.new(G(sx * x, FY - 0.14 + yy, le - c * ch)))
        loops.append(loop)
    for A, B in zip(loops, loops[1:]):
        for j in range(N):
            j1 = (j + 1) % N; bm.faces.new((A[j], A[j1], B[j1], B[j]))
    bm.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    smooth(obj_from_bm('wing', bm, M['paint']), 40)
    tube('wing_edge', [(sx * 0.62, FY - 0.1, 0.38), (sx * 2.95, FY - 0.13, -1.33)], 0.02, M['trim'])
    tube('flap_line', [(sx * 1.2, FY - 0.08, -1.65), (sx * 2.7, FY - 0.11, -1.95)], 0.012, M['gun'])
    box('wingtip_cap', (0.06, 0.07, 0.75), (sx * 3.03, FY - 0.14, -1.68), material=M['gun'], bevel=0.02)

# ── Tail fin: tall, raked, on the spine.
for sx in (1, -1):
    tf = plate('tail', [(0.3, 0.0), (-0.8, 1.05), (-1.35, 1.1), (-1.7, 0.0)], 0.14, M['paint'], 'x', 0.0, 0.035)
    place(tf, (0, 0, -0.38 * sx), (0.3 * sx, _top(-2.3) - 0.08, -1.9))
    tt = plate('tail_flash', [(-0.45, 0.6), (-0.78, 1.0), (-0.92, 1.0), (-0.6, 0.6)], 0.11, M['gun'], 'x', 0.0, 0.01)
    place(tt, (0, 0, -0.38 * sx), (0.3 * sx, _top(-2.3) - 0.08, -1.9))

# ── Top machinery ahead of the main nozzle, then the main nozzle.
MZ0, MZ1 = -2.0, -3.4
smooth(lathe('main_core', [(MZ0, 0.3), (MZ1, 0.32)], 0, FY + 0.05, 24, M['gun']), 40)
for (z0, z1, r, m) in [(MZ0 - 0.05, MZ0 - 0.35, 0.4, 'brass'), (MZ0 - 0.45, MZ0 - 0.9, 0.44, 'gun'), (MZ0 - 1.0, MZ1, 0.4, 'carbon')]:
    smooth(lathe('mstage', [(z0, r * 0.94), (z0 - 0.03, r), (z1 + 0.03, r), (z1, r * 0.94)], 0, FY + 0.05, 24, M[m], cap0=True, cap1=True), 40)
smooth(lathe('main_nozzle', [(MZ1, 0.42), (MZ1 - 0.12, 0.46), (NZ + 0.05, 0.44), (NZ, 0.4)], 0, FY + 0.05, 36, M['metal']), 30)
flared_lip('main_lip', 0, FY + 0.05, NZ + 0.08, 0.4, 0.22, M)
cyl('main_hot', 0.32, 0.02, (0, FY + 0.05, MZ1 - 0.1), 'z', 28, M['hot'])
for z in (MZ0 - 0.4, MZ0 - 0.95):
    ring('mflange', 0.45, 0.02, (0, FY + 0.05, z), 22, M['metal'], minor=3)

# ── Under-slung engines: a white intake can, exposed machinery, nozzle.
right.append(smooth(lathe('ecan', [(-0.6, ER - 0.05), (-0.55, ER), (-0.62, ER + 0.03), (-1.6, ER + 0.03), (-1.7, ER)], EX, EY, 36, M['paint'], cap1=True), 30))
right.append(smooth(lathe('ecan_band', [(-1.35, ER + 0.035), (-1.55, ER + 0.035)], EX, EY, 36, M['trim']), 30))
right.append(smooth(lathe('educt', [(-0.6, ER - 0.05), (-0.85, ER - 0.07)], EX, EY, 28, M['carbon'], cap1=True), 60))
right.append(fan_smooth('efan', EX, EY, -0.78, 0.12, ER - 0.08, 14, 0.75, 0.16, 3, M['gun']))
right.append(smooth(lathe('espinner', [(-0.6, 0.006), (-0.63, 0.06), (-0.7, 0.11), (-0.78, 0.13), (-0.9, 0.13)], EX, EY, 28, M['gun'], cap1=True), 85))
for (z0, z1, r, m) in [(-1.75, -2.1, 0.4, 'gun'), (-2.2, -2.4, 0.36, 'brass'), (-2.5, -3.1, 0.41, 'gun')]:
    right.append(smooth(lathe('estage', [(z0, r * 0.94), (z0 - 0.03, r), (z1 + 0.03, r), (z1, r * 0.94)], EX, EY, 24, M[m], cap0=True, cap1=True), 40))
    right.append(ring('eflange', r + 0.01, 0.018, (EX, EY, z0 - 0.02), 20, M['metal'], minor=3))
right.append(smooth(lathe('enozzle', [(-3.1, 0.4), (-3.2, 0.42), (NZ + 0.05, 0.4), (NZ, 0.36)], EX, EY, 32, M['gun']), 30))
right.append(smooth(lathe('eliner', [(NZ, 0.34), (-3.3, 0.28), (-3.2, 0.0)], EX, EY, 28, M['carbon']), 60))
right.append(cyl('ehot', 0.28, 0.02, (EX, EY, -3.25), 'z', 24, M['hot']))
# Faired pylon from the fuselage belly to each engine.
right.append(poly_loft('epylon', [(-0.4, EX * 0.6, (FY + EY) / 2 + 0.05, 0.03, 0.04, 0.04), (-0.9, EX * 0.6, (FY + EY) / 2 + 0.05, 0.12, 0.22, 0.22), (-2.9, EX * 0.6, (FY + EY) / 2 + 0.05, 0.12, 0.22, 0.22), (-3.3, EX * 0.6, (FY + EY) / 2 + 0.05, 0.03, 0.04, 0.04)], [(1, 0), (0.5, 1), (-0.5, 1), (-1, 0), (-0.5, -1), (0.5, -1)], 30, M['paint'], angle=50))
right.append(box('eglow', (0.06, 0.012, 1.4), (EX, EY - ER - 0.04, -1.3), material=M['glow']))
join_mirror(right)
poly_loft('keel', [(0.2, 0, FY - 0.36, 0.03, 0.04, 0.04), (-0.5, 0, FY - 0.4, 0.14, 0.06, 0.08), (-2.6, 0, FY - 0.4, 0.14, 0.06, 0.08), (-3.2, 0, FY - 0.38, 0.03, 0.04, 0.04)], [(1, 0), (0.5, 1), (-0.5, 1), (-1, 0), (-0.5, -1), (0.5, -1)], 24, M['gun'], angle=50)

# Game hooks.
empty('nozzle_0@0.7', (-EX, EY, NZ)); empty('nozzle_1@0.75', (0, FY + 0.05, NZ)); empty('nozzle_2@0.7', (EX, EY, NZ))
empty('wingtip', (3.05, FY - 0.14, -1.7))
empty('number@0.45', (0.3 + 0.55 * math.sin(0.38) + 0.06, _top(-2.3) - 0.08 + 0.55 * math.cos(0.38), -2.55))

out = os.environ.get('OUT', '/tmp')
print('TRIANGLES', tri_count()); tri_report()
export_glb(out + '/lance.glb')
if not os.environ.get('NORENDER'): render_views(out + '/lance')
finish()
