# NEEDLE — from concept art/ships/concepts/needle-1.png. A long, thin needle body (sharp chined nose,
# orange stripe and dark panels) carrying a big exposed central engine at the back with a spiked
# nozzle; a pilot gondola slung under the body with a glass front; two small side engine pods on
# swept arms, little winglets outboard; canted twin fins on top, a low V tail below.
# Game frame: x right, y up, z forward. The three exhausts end on one exit plane.
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

NZ = -4.2
BY = 1.05                      # body centre height
EZ0, EZ1 = -1.0, -3.55         # central engine exposed section
PX, PY = 1.65, 0.8             # side pod centre
right = []

# ── Body: a long chined needle, flat-topped wedge section, ending over the engine.
HEX = [(1.0, 0.0), (0.8, 0.5), (0.45, 0.92), (0.0, 1.0), (-0.45, 0.92), (-0.8, 0.5), (-1.0, 0.0), (-0.78, -0.55), (-0.4, -0.92), (0.0, -1.0), (0.4, -0.92), (0.78, -0.55)]
BODY = [(7.0, 0, BY - 0.08, 0.03, 0.02, 0.02), (5.6, 0, BY - 0.04, 0.26, 0.1, 0.1), (3.2, 0, BY, 0.5, 0.26, 0.2), (0.8, 0, BY + 0.04, 0.6, 0.36, 0.26),
        (-0.8, 0, BY + 0.04, 0.6, 0.38, 0.28), (-1.4, 0, BY + 0.04, 0.5, 0.36, 0.26)]
poly_loft('body', BODY, HEX, 56, M['paint'], angle=40)
_zs = sorted(b[0] for b in BODY); _top = _mono_cubic(_zs, [next(b[2] + b[4] for b in BODY if b[0] == z) for z in _zs])
_hw = _mono_cubic(_zs, [next(b[3] for b in BODY if b[0] == z) for z in _zs])
# Livery: an orange line along each chine, a dark panel near the middle (raised a hair).
for sx in (1, -1):
    poly_loft('chine_line', [(z, sx * (_hw(z) * 0.9), BY + 0.02 + 0.08 * (z / 7), 0.012, 0.02, 0.02) for z in (5.8, 4.0, 2.0, 0.4, -1.1)], [(1, 0), (0, 1), (-1, 0), (0, -1)], 40, M['trim'], cap1=True, angle=80)
    poly_loft('dark_panel', [(z, sx * _hw(z) * 0.72, _top(z) - 0.06, 0.12, 0.04, 0.04) for z in (2.2, 1.4, 0.6)], [(1, 0), (0.6, 1), (-0.6, 1), (-1, 0), (-0.6, -1), (0.6, -1)], 16, M['gun'], cap1=True, angle=70)
poly_loft('top_stripe', [(z, 0, _top(z) + 0.004, 0.07, 0.01, 0.01) for z in (5.4, 3.0, 0.6, -1.2)], [(1, 0), (0.9, 1), (-0.9, 1), (-1, 0), (-0.9, -1), (0.9, -1)], 40, M['trim'], cap1=True, angle=80)
# A small canopy slot on top, forward of the engine.
poly_loft('top_canopy', [(1.4, 0, _top(1.0) - 0.02, 0.05, 0.02, 0.02), (1.1, 0, _top(1.0) - 0.02, 0.22, 0.08, 0.02), (0.4, 0, _top(0.6) - 0.02, 0.24, 0.09, 0.02), (0.1, 0, _top(0.3) - 0.02, 0.05, 0.02, 0.02)],
          [(math.cos(t), math.sin(t) ** 0.8) for t in [i * math.pi / 10 for i in range(11)]] + [(0.0, -1.0)], 16, M['glass'], angle=70)

# ── Gondola: the pilot pod slung under the body, glass front, side windows.
GY = 0.48
gond = [(3.0, 0, GY, 0.05, 0.05, 0.05, 2.0), (2.6, 0, GY, 0.36, 0.26, 0.22, 2.2), (1.2, 0, GY, 0.48, 0.32, 0.26, 2.4), (-0.6, 0, GY, 0.46, 0.3, 0.26, 2.4), (-1.3, 0, GY + 0.05, 0.3, 0.22, 0.2, 2.2)]
smooth_loft('gondola', gond, 32, 28, M['paint'])
smooth_loft('gond_glass', [(3.04, 0, GY + 0.03, 0.04, 0.04, 0.04, 2), (2.85, 0, GY + 0.03, 0.26, 0.2, 0.14, 2.2), (2.45, 0, GY + 0.03, 0.34, 0.25, 0.18, 2.2), (2.2, 0, GY + 0.03, 0.2, 0.15, 0.1, 2)], 28, 16, M['glass'])
for sx in (1, -1):
    box('gond_window', (0.03, 0.14, 0.7), (sx * 0.47, GY + 0.1, 1.3), material=M['glass'])
    poly_loft('gond_stripe', [(z, sx * 0.47, GY - 0.1, 0.012, 0.035, 0.035) for z in (2.3, 1.2, 0.0, -0.9)], [(1, 0), (0, 1), (-1, 0), (0, -1)], 24, M['trim'], cap1=True, angle=80)
# The gondola's pylon into the body.
poly_loft('gond_pylon', [(2.2, 0, GY + 0.3, 0.05, 0.06, 0.06), (1.6, 0, GY + 0.34, 0.28, 0.22, 0.16), (-0.6, 0, GY + 0.36, 0.3, 0.22, 0.16), (-1.2, 0, GY + 0.34, 0.08, 0.06, 0.06)], [(1, 0), (0.5, 1), (-0.5, 1), (-1, 0), (-0.5, -1), (0.5, -1)], 32, M['gun'], angle=50)
box('belly_glow', (0.06, 0.01, 2.6), (0, GY - 0.26, 1.0), material=M['glow'])

# ── Central engine: exposed machinery from the body's tail to the spiked nozzle.
EY = BY - 0.02
smooth(lathe('eng_core', [(EZ0 + 0.3, 0.5), (EZ0, 0.52), (EZ1, 0.5)], 0, EY, 32, M['gun']), 40)
for (z0, z1, r, m) in [(EZ0 - 0.05, EZ0 - 0.45, 0.62, 'gun'), (EZ0 - 0.55, EZ0 - 0.75, 0.56, 'brass'), (EZ0 - 0.85, EZ0 - 1.45, 0.64, 'gun'), (EZ0 - 1.55, EZ0 - 1.75, 0.55, 'carbon'), (EZ0 - 1.85, EZ1, 0.6, 'gun')]:
    smooth(lathe('stage', [(z0, r * 0.94), (z0 - 0.03, r), (z1 + 0.03, r), (z1, r * 0.94)], 0, EY, 28, M[m], cap0=True, cap1=True), 40)
    for z in (z0 - 0.02, z1 + 0.02):
        ring('flange', r + 0.01, 0.022, (0, EY, z), 22, M['metal'], minor=4)
for i in range(16):  # radial ribs on the long stage
    a = 2 * math.pi * (i + 0.5) / 16
    box('rib', (0.04, 0.05, 0.5), (0.66 * math.cos(a), EY + 0.66 * math.sin(a), EZ0 - 1.15), (0, 0, a - math.pi / 2), M['metal'])
for (a, rr) in [(0.6, 0.11), (2.5, 0.1), (3.9, 0.12), (5.3, 0.1)]:  # canisters strapped round the engine
    x, y = (0.62 + rr) * math.cos(a), EY + (0.62 + rr) * math.sin(a)
    cyl('canister', rr, 1.4, (x, y, EZ0 - 1.15), 'z', 12, M['metal'])
    for z in (EZ0 - 0.5, EZ0 - 1.8):
        cyl('canister_cap', rr * 1.1, 0.07, (x, y, z), 'z', 12, M['trim'])
    box('strap', (0.14, rr + 0.14, 0.1), ((0.56 + rr / 2) * math.cos(a), EY + (0.56 + rr / 2) * math.sin(a), EZ0 - 1.15), (0, 0, a - math.pi / 2), M['gun'])
smooth(lathe('nozzle', [(EZ1, 0.62), (EZ1 - 0.15, 0.68), (NZ + 0.15, 0.66), (NZ + 0.05, 0.6)], 0, EY, 40, M['metal']), 30)
ring('nozzle_band', 0.69, 0.06, (0, EY, EZ1 - 0.25), 40, M['trim'])
petals('petals', 0, EY, NZ + 0.08, 0.6, 14, 0.36, 0.22, -0.18, 0.014, M['gun'])
smooth(lathe('liner', [(NZ + 0.1, 0.56), (EZ1 - 0.1, 0.48), (EZ1, 0.0)], 0, EY, 32, M['carbon']), 60)
cyl('hot', 0.46, 0.02, (0, EY, EZ1 - 0.12), 'z', 32, M['hot'])

# ── Side pods on swept arms, winglets outboard.
right.append(smooth(lathe('pod', [(-1.2, 0.2), (-1.3, 0.34), (-1.6, 0.38), (-3.3, 0.37), (-3.8, 0.33), (NZ + 0.05, 0.3)], PX, PY, 32, M['paint']), 35))
right.append(smooth(lathe('pod_band', [(-3.0, 0.375), (-3.35, 0.372)], PX, PY, 32, M['trim']), 35))
right.append(smooth(lathe('pod_duct', [(-1.2, 0.2), (-1.35, 0.18)], PX, PY, 24, M['carbon'], cap1=True), 60))
right.append(fan_smooth('pod_fan', PX, PY, -1.32, 0.07, 0.2, 12, 0.7, 0.14, 3, M['gun']))
right.append(smooth(lathe('pod_nozzle', [(NZ + 0.05, 0.3), (NZ, 0.28), (NZ + 0.15, 0.24)], PX, PY, 28, M['metal']), 40))
right.append(cyl('pod_hot', 0.22, 0.02, (PX, PY, NZ + 0.14), 'z', 20, M['hot']))
for dz in (0.0, 0.16):
    right.append(box('pod_vent', (0.04, 0.14, 0.08), (PX - 0.2 + dz, PY + 0.37, -2.0), material=M['carbon']))
arm = smooth_loft('arm', [(-0.15, 0, 0, 0.36, 0.06, 0.06, 2.0), (0.4, 0, 0, 0.32, 0.05, 0.05, 2.0), (1.0, 0, 0, 0.3, 0.05, 0.05, 2.0)], 16, 10, M['gun'], cap0=True, cap1=True)
place(arm, (0, math.pi / 2, 0.25), (0.4, BY - 0.12, -2.1)); right.append(arm)
wl = plate('winglet', [(0.0, 0.0), (0.0, 0.08), (-0.7, 0.1), (-0.95, 0.04), (-0.7, -0.02)], 0.05, M['paint'], 'y', 0.0, 0.015)
right.append(plate('winglet', [(PX + 0.36, -1.8), (PX + 0.36, -2.7), (PX + 1.1, -3.05), (PX + 1.15, -2.75)], 0.05, M['paint'], 'y', PY, 0.015))
right.append(plate('winglet_tip', [(PX + 0.95, -2.95), (PX + 1.1, -3.05), (PX + 1.15, -2.75), (PX + 1.02, -2.72)], 0.06, M['trim'], 'y', PY, 0.01))
bpy.data.objects.remove(wl)
# ── Fins: canted twins on top at the tail, a low V below.
for sx in (1, -1):
    f = plate('fin', [(0.0, 0.0), (-0.55, 0.85), (-0.95, 0.88), (-1.1, 0.0)], 0.07, M['paint'], 'x', 0.0, 0.025)
    place(f, (0, 0, -0.32 * sx), (0.25 * sx, BY + 0.32, -1.2))
    ft = plate('fin_tip', [(-0.5, 0.78), (-0.56, 0.86), (-0.96, 0.89), (-0.9, 0.8)], 0.08, M['trim'], 'x', 0.0, 0.015)
    place(ft, (0, 0, -0.32 * sx), (0.25 * sx, BY + 0.32, -1.2))
    v = plate('vtail', [(0.0, 0.0), (-0.45, -0.6), (-0.8, -0.62), (-0.85, 0.0)], 0.06, M['paint'], 'x', 0.0, 0.02)
    place(v, (0, 0, 0.55 * sx), (0.3 * sx, EY - 0.52, -3.0))
    vt = plate('vtail_tip', [(-0.42, -0.55), (-0.46, -0.61), (-0.8, -0.63), (-0.76, -0.56)], 0.07, M['trim'], 'x', 0.0, 0.01)
    place(vt, (0, 0, 0.55 * sx), (0.3 * sx, EY - 0.52, -3.0))
join_mirror(right)

# Game hooks.
empty('nozzle_0', (-PX, PY, NZ)); empty('nozzle_1@1.2', (0, EY, NZ)); empty('nozzle_2', (PX, PY, NZ))
empty('wingtip', (PX + 1.12, PY, -2.9))
empty('number', (0.5, BY + 0.08, -0.3))

out = os.environ.get('OUT', '/tmp')
print('TRIANGLES', tri_count()); tri_report()
export_glb(out + '/needle.glb')
if not os.environ.get('NORENDER'): render_views(out + '/needle')
finish()
