# VANGUARD — from concept art/ships/concepts/vanguard-0.png. A blended delta lifting body: a flat
# pancake nose, a raised spine with the canopy forward, wide swept wings that thin to the edge with
# vents at the tips; two engine cans riding on the rear deck with their machinery exposed ahead of
# ribbed nozzles; twin intakes under the wing roots. Game frame: x right, y up, z forward.
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

NZ = -3.7
BY = 0.62               # body centre plane
EX, EY = 0.88, 1.12     # engine centre (riding on the rear deck)
right = []

# ── Body: the delta as one lens-section loft — wide and thin at the wings, thick at the centre.
WING = [(5.2, 0, BY - 0.04, 0.12, 0.05, 0.05, 2.0), (4.4, 0, BY - 0.02, 0.62, 0.16, 0.14, 2.3), (2.8, 0, BY, 1.35, 0.28, 0.2, 2.4),
        (0.8, 0, BY, 2.35, 0.34, 0.24, 2.4), (-1.0, 0, BY, 3.0, 0.36, 0.25, 2.5), (-2.0, 0, BY, 3.15, 0.3, 0.22, 2.6), (-2.45, 0, BY, 2.9, 0.2, 0.16, 2.6), (-2.6, 0, BY, 2.2, 0.1, 0.1, 2.4)]
smooth_loft('body', WING, 64, 60, M['paint'], cap1=True, angle=60)
# Spine: a raised fuselage down the centre carrying the canopy, blending into the body.
SPINE = [(4.7, 0, BY + 0.02, 0.1, 0.06, 0.06, 2.0), (3.8, 0, BY + 0.06, 0.44, 0.3, 0.12, 2.4), (2.0, 0, BY + 0.08, 0.56, 0.44, 0.14, 2.6),
         (-0.5, 0, BY + 0.08, 0.6, 0.46, 0.14, 2.8), (-2.4, 0, BY + 0.06, 0.5, 0.38, 0.12, 2.6), (-3.2, 0, BY + 0.06, 0.34, 0.28, 0.12, 2.2)]
smooth_loft('spine', SPINE, 32, 50, M['paint'], cap1=True)
_zs = sorted(r[0] for r in SPINE); _top = _mono_cubic(_zs, [next(r[2] + r[4] for r in SPINE if r[0] == z) for z in _zs])
# Canopy forward on the spine, smoked, with a gunmetal frame.
smooth_loft('canopy_frame', [(3.5, 0, _top(2.6) - 0.05, 0.08, 0.08, 0.03, 2.2), (3.1, 0, _top(2.6) - 0.05, 0.38, 0.12, 0.03, 2.4), (2.2, 0, _top(2.2) - 0.05, 0.46, 0.13, 0.03, 2.4), (1.3, 0, _top(1.4) - 0.05, 0.4, 0.12, 0.03, 2.4), (1.0, 0, _top(1.2) - 0.05, 0.08, 0.08, 0.03, 2.2)], 24, 20, M['gun'])
smooth_loft('canopy', [(3.45, 0, _top(2.6) - 0.03, 0.05, 0.03, 0.02, 2.0), (3.05, 0, _top(2.6) - 0.03, 0.34, 0.2, 0.02, 2.2), (2.2, 0, _top(2.2) - 0.03, 0.42, 0.3, 0.02, 2.2), (1.35, 0, _top(1.4) - 0.03, 0.36, 0.2, 0.02, 2.2), (1.05, 0, _top(1.2) - 0.03, 0.05, 0.03, 0.02, 2.0)], 28, 20, M['glass'])
# A dark spine strip behind the canopy.
poly_loft('spine_strip', [(z, 0, _top(z) + 0.003, 0.12, 0.012, 0.012) for z in (0.8, -0.4, -1.6, -2.6)], [(1, 0), (0.9, 1), (-0.9, 1), (-1, 0), (-0.9, -1), (0.9, -1)], 24, M['gun'], cap1=True, angle=80)

# ── Wingtip vents (dark recessed slots with slats) and side vents under the nose.
right.append(box('tip_vent', (0.34, 0.06, 0.5), (2.85, BY + 0.06, -1.6), (0, -0.3, 0), M['carbon'], bevel=0.01))
for dz in (-0.15, 0.0, 0.15):
    right.append(box('tip_slat', (0.32, 0.07, 0.04), (2.85, BY + 0.07, -1.6 + dz), (0, -0.3, 0), M['gun']))
right.append(box('nose_vent', (0.05, 0.06, 0.5), (0.86, BY - 0.02, 3.0), (0, -0.55, 0), M['carbon']))
# Under-wing intakes: round ducts under the wing roots with fans.
IX, IY, IZ = 0.95, BY - 0.36, 1.6
right.append(smooth_loft('intake_house', [(IZ + 0.05, IX, IY, 0.28, 0.26, 0.26, 2.2), (IZ - 0.1, IX, IY, 0.33, 0.3, 0.3, 2.2), (IZ - 1.6, IX, IY + 0.08, 0.3, 0.26, 0.26, 2.2), (IZ - 2.3, IX, IY + 0.2, 0.05, 0.05, 0.05, 2.0)], 28, 20, M['paint'], cap1=True))
right.append(smooth(lathe('intake_duct', [(IZ + 0.05, 0.27), (IZ - 0.15, 0.25)], IX, IY, 28, M['carbon'], cap1=True), 60))
right.append(fan_smooth('intake_fan', IX, IY, IZ - 0.1, 0.08, 0.24, 14, 0.7, 0.14, 3, M['metal']))

# ── Engines on the rear deck: exposed machinery, then a white rear can with a ribbed nozzle.
EZ0, EZ1 = -0.4, -2.2     # machinery, then the can to NZ
right.append(smooth(lathe('eng_core', [(EZ0 + 0.1, 0.36), (EZ0, 0.4), (EZ1, 0.4)], EX, EY, 28, M['gun']), 40))
for (z0, z1, r, m) in [(EZ0 - 0.05, EZ0 - 0.4, 0.5, 'gun'), (EZ0 - 0.5, EZ0 - 0.7, 0.44, 'brass'), (EZ0 - 0.8, EZ0 - 1.4, 0.52, 'gun'), (EZ0 - 1.5, EZ1 + 0.05, 0.46, 'carbon')]:
    right.append(smooth(lathe('stage', [(z0, r * 0.94), (z0 - 0.03, r), (z1 + 0.03, r), (z1, r * 0.94)], EX, EY, 26, M[m], cap0=True, cap1=True), 40))
    for z in (z0 - 0.02, z1 + 0.02):
        right.append(ring('flange', r + 0.01, 0.02, (EX, EY, z), 20, M['metal'], minor=3))
for (a, col) in [(0.8, 'trim'), (2.2, 'brass'), (3.6, 'trim')]:
    right.append(tube('pipe', [(EX + 0.54 * math.cos(a), EY + 0.54 * math.sin(a), z) for z in (EZ0 - 0.05, (EZ0 + EZ1) / 2, EZ1 + 0.05)], 0.035, M[col]))
for (a, rr) in [(0.0, 0.09), (2.9, 0.08)]:
    x, y = EX + (0.52 + rr) * math.cos(a), EY + (0.52 + rr) * math.sin(a)
    right.append(cyl('canister', rr, 1.0, (x, y, (EZ0 + EZ1) / 2), 'z', 12, M['metal']))
    right.append(box('strap', (0.1, rr + 0.12, 0.1), (EX + (0.46 + rr / 2) * math.cos(a), EY + (0.46 + rr / 2) * math.sin(a), (EZ0 + EZ1) / 2), (0, 0, a - math.pi / 2), M['gun']))
right.append(smooth(lathe('can', [(EZ1, 0.5), (EZ1 - 0.05, 0.55), (-3.0, 0.56), (-3.25, 0.53)], EX, EY, 36, M['paint'], cap0=True), 35))
right.append(smooth(lathe('can_band', [(EZ1 - 0.15, 0.555), (EZ1 - 0.35, 0.555)], EX, EY, 36, M['trim']), 35))
right.append(box('can_window', (0.04, 0.16, 0.3), (EX + 0.555, EY + 0.05, -2.75), material=M['carbon']))
right.append(smooth(lathe('nozzle', [(-3.25, 0.5), (-3.4, 0.52), (NZ + 0.05, 0.5), (NZ, 0.46)], EX, EY, 36, M['gun']), 30))
for i in range(18):  # ribbed nozzle
    a = 2 * math.pi * i / 18
    right.append(box('rib', (0.05, 0.05, 0.42), (EX + 0.52 * math.cos(a), EY + 0.52 * math.sin(a), -3.48), (0, 0, a - math.pi / 2), M['metal']))
right.append(smooth(lathe('liner', [(NZ, 0.44), (-3.35, 0.36), (-3.25, 0.0)], EX, EY, 28, M['carbon']), 60))
right.append(cyl('hot', 0.36, 0.02, (EX, EY, -3.3), 'z', 28, M['hot']))
# Engine mounts: a saddle pylon from the deck up to each engine.
right.append(poly_loft('eng_pylon', [(0.2, EX, BY + 0.3, 0.04, 0.04, 0.04), (-0.2, EX, BY + 0.34, 0.26, 0.2, 0.14), (-2.6, EX, BY + 0.34, 0.26, 0.2, 0.14), (-3.0, EX, BY + 0.3, 0.04, 0.04, 0.04)], [(1, 0), (0.6, 1), (-0.6, 1), (-1, 0), (-0.6, -1), (0.6, -1)], 30, M['gun'], angle=50))
join_mirror(right)

# Centre thruster at the spine's tail.
smooth(lathe('tail_nozzle', [(-3.2, 0.24), (-3.4, 0.26), (NZ, 0.24)], 0, BY + 0.1, 28, M['metal']), 40)
smooth(lathe('tail_liner', [(NZ, 0.22), (-3.35, 0.18), (-3.25, 0.0)], 0, BY + 0.1, 24, M['carbon']), 60)
cyl('tail_hot', 0.17, 0.02, (0, BY + 0.1, -3.3), 'z', 20, M['hot'])
box('belly_glow', (1.6, 0.012, 3.0), (0, BY - 0.24, 0.6), material=M['glow'])

# Game hooks.
empty('nozzle_0', (-EX, EY, NZ)); empty('nozzle_1@0.45', (0, BY + 0.1, NZ)); empty('nozzle_2', (EX, EY, NZ))
empty('wingtip', (3.1, BY, -2.1))
empty('number', (EX + 0.57, EY, -2.75 + 0.4))

out = os.environ.get('OUT', '/tmp')
print('TRIANGLES', tri_count()); tri_report()
export_glb(out + '/vanguard.glb')
if not os.environ.get('NORENDER'): render_views(out + '/vanguard')
finish()
