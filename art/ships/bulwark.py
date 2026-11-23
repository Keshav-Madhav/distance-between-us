# BULWARK — from concept art/ships/concepts/bulwark-0.png. An arrowhead delta with a pointed nose, a
# raised cockpit hump and blunt squared wingtips; two big fan nacelles slung through the wings, their
# rear machinery exposed ahead of large nozzles; a ventral fin under each nacelle; a machinery block
# between the nacelles at the back. Game frame: x right, y up, z forward.
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

NZ = -3.15
BY = 0.66
NX, NY, NR = 1.72, 0.62, 0.56     # nacelle centre and radius
NF, NB = 1.9, -1.35               # nacelle can front (fan) and back (machinery starts)
right = []

# ── Body: a sharp arrowhead lens delta with squared tips.
WING = [(5.0, 0, BY - 0.05, 0.05, 0.03, 0.03, 1.8), (4.0, 0, BY - 0.02, 0.5, 0.14, 0.12, 1.9), (2.2, 0, BY, 1.3, 0.26, 0.2, 1.9),
        (0.4, 0, BY, 2.3, 0.3, 0.22, 1.9), (-0.9, 0, BY, 2.95, 0.3, 0.22, 1.9), (-1.2, 0, BY, 3.05, 0.28, 0.21, 1.9), (-2.05, 0, BY, 3.05, 0.22, 0.18, 1.9), (-2.25, 0, BY, 2.3, 0.1, 0.09, 1.8)]
smooth_loft('body', WING, 64, 60, M['paint'], cap1=True, angle=60)
# Cockpit hump down the centre, the canopy set into it.
HUMP = [(4.4, 0, BY, 0.1, 0.05, 0.05, 2.0), (3.4, 0, BY + 0.04, 0.46, 0.34, 0.12, 2.6), (1.6, 0, BY + 0.06, 0.62, 0.6, 0.14, 3.0),
        (-0.6, 0, BY + 0.06, 0.66, 0.64, 0.14, 3.2), (-2.2, 0, BY + 0.05, 0.6, 0.56, 0.12, 3.0), (-2.8, 0, BY + 0.05, 0.42, 0.42, 0.12, 2.6)]
smooth_loft('hump', HUMP, 36, 50, M['paint'], cap1=True)
_zs = sorted(r[0] for r in HUMP); _top = _mono_cubic(_zs, [next(r[2] + r[4] for r in HUMP if r[0] == z) for z in _zs])
smooth_loft('canopy', [(2.9, 0, _top(2.7) - 0.08, 0.05, 0.03, 0.02, 2.0), (2.5, 0, _top(2.4) - 0.08, 0.34, 0.16, 0.02, 2.4), (1.6, 0, _top(1.6) - 0.08, 0.46, 0.24, 0.02, 2.4), (0.6, 0, _top(0.6) - 0.08, 0.42, 0.18, 0.02, 2.4), (0.2, 0, _top(0.3) - 0.08, 0.05, 0.03, 0.02, 2.0)], 28, 20, M['glass'])
poly_loft('hump_strip', [(z, 0, _top(z) + 0.003, 0.18, 0.012, 0.012) for z in (0.0, -1.2, -2.5)], [(1, 0), (0.9, 1), (-0.9, 1), (-1, 0), (-0.9, -1), (0.9, -1)], 20, M['gun'], cap1=True, angle=80)
for sx in (1, -1):  # cockpit side vents
    for dz in (0.0, 0.16, 0.32):
        box('hump_vent', (0.04, 0.16, 0.08), (sx * 0.65, BY + 0.38, -0.3 - dz), (0.3, 0, 0), M['gun'])

# ── Nacelles: big fan intakes at the front, a white can, then exposed machinery and a large nozzle.
lip = [(NF + 0.06, NR - 0.06), (NF + 0.1, NR), (NF + 0.06, NR + 0.06), (NF - 0.1, NR + 0.08)]
right.append(smooth(lathe('can', lip + [(NF - 0.6, NR + 0.08), (NB + 0.3, NR + 0.06), (NB, NR + 0.02)], NX, NY, 48, M['paint'], cap1=True), 30))
right.append(smooth(lathe('can_band', [(NF - 0.15, NR + 0.085), (NF - 0.42, NR + 0.085)], NX, NY, 48, M['trim']), 30))
right.append(smooth(lathe('can_band2', [(NB + 0.55, NR + 0.065), (NB + 0.38, NR + 0.065)], NX, NY, 48, M['trim']), 30))
right.append(smooth(lathe('duct', [(NF + 0.06, NR - 0.06), (NF - 0.3, NR - 0.08)], NX, NY, 36, M['carbon'], cap1=True), 60))
right.append(fan_smooth('fan', NX, NY, NF - 0.2, 0.17, NR - 0.09, 18, 0.75, 0.24, 4, M['gun']))
right.append(smooth(lathe('spinner', [(NF + 0.05, 0.006), (NF + 0.02, 0.06), (NF - 0.06, 0.12), (NF - 0.16, 0.17), (NF - 0.22, 0.19), (NF - 0.4, 0.19)], NX, NY, 40, M['gun'], cap1=True), 85))
right.append(ring('shroud', NR - 0.08, 0.025, (NX, NY, NF - 0.2), 36, M['carbon']))
# Machinery behind the can.
right.append(smooth(lathe('core', [(NB, 0.42), (NB - 0.9, 0.44)], NX, NY, 28, M['gun']), 40))
for (z0, z1, r, m) in [(NB - 0.05, NB - 0.3, 0.52, 'brass'), (NB - 0.4, NB - 0.75, 0.56, 'gun'), (NB - 0.85, NB - 0.95, 0.5, 'carbon')]:
    right.append(smooth(lathe('stage', [(z0, r * 0.94), (z0 - 0.03, r), (z1 + 0.03, r), (z1, r * 0.94)], NX, NY, 26, M[m], cap0=True, cap1=True), 40))
    right.append(ring('flange', r + 0.01, 0.02, (NX, NY, z0 - 0.02), 20, M['metal'], minor=3))
for (a, rr) in [(0.4, 0.09), (2.6, 0.1), (4.2, 0.09)]:
    x, y = NX + (0.56 + rr) * math.cos(a), NY + (0.56 + rr) * math.sin(a)
    right.append(cyl('canister', rr, 0.8, (x, y, NB - 0.5), 'z', 12, M['metal']))
    right.append(box('strap', (0.1, rr + 0.12, 0.1), (NX + (0.5 + rr / 2) * math.cos(a), NY + (0.5 + rr / 2) * math.sin(a), NB - 0.5), (0, 0, a - math.pi / 2), M['gun']))
right.append(smooth(lathe('nozzle', [(NB - 0.95, 0.56), (NB - 1.1, 0.6), (NZ + 0.05, 0.58), (NZ, 0.54)], NX, NY, 40, M['gun']), 30))
for i in range(16):
    a = 2 * math.pi * i / 16
    right.append(box('rib', (0.05, 0.05, 0.4), (NX + 0.6 * math.cos(a), NY + 0.6 * math.sin(a), (NB - 1.1 + NZ) / 2), (0, 0, a - math.pi / 2), M['metal']))
right.append(smooth(lathe('liner', [(NZ, 0.52), (NB - 1.2, 0.42), (NB - 1.1, 0.0)], NX, NY, 32, M['carbon']), 60))
right.append(cyl('hot', 0.42, 0.02, (NX, NY, NB - 1.15), 'z', 32, M['hot']))
# Ventral fin under each nacelle, with a hover-glow foot.
right.append(plate('ventral', [(NF - 0.9, NY - NR - 0.02), (NB + 0.6, NY - NR - 0.02), (NB + 0.2, NY - NR - 0.62), (NF - 1.5, NY - NR - 0.58)], 0.12, M['paint'], 'x', NX, 0.04))
right.append(plate('ventral_tip', [(NB + 0.25, NY - NR - 0.55), (NB + 0.2, NY - NR - 0.63), (NF - 1.5, NY - NR - 0.59), (NF - 1.45, NY - NR - 0.52)], 0.13, M['trim'], 'x', NX, 0.02))
right.append(box('foot_glow', (0.06, 0.012, 1.0), (NX, NY - NR - 0.63, (NF + NB) / 2 - 0.4), material=M['glow']))
# Wingtip end cap with vents; wing panels.
right.append(box('tip_cap', (0.1, 0.2, 0.85), (3.08, BY, -1.62), material=M['gun'], bevel=0.03))
for dz in (-0.25, -0.08, 0.09, 0.26):
    right.append(box('tip_slot', (0.03, 0.06, 0.1), (3.14, BY, -1.62 + dz), material=M['carbon']))
right.append(box('wing_panel', (0.55, 0.02, 0.45), (2.55, BY + 0.2, -0.7), (0, -0.4, 0), M['gun'], bevel=0.01))
join_mirror(right)

# ── Rear centre machinery block between the nacelles, and the centre thruster.
box('rear_block', (0.8, 0.36, 0.8), (0, BY + 0.25, -2.3), material=M['gun'], bevel=0.04)
for dx in (-0.25, 0.0, 0.25):
    cyl('rear_can', 0.08, 0.5, (dx, BY + 0.5, -2.3), 'y', 12, M['metal'])
    cyl('rear_cap', 0.09, 0.05, (dx, BY + 0.76, -2.3), 'y', 12, M['trim'])
smooth(lathe('tail_nozzle', [(-2.8, 0.24), (-3.0, 0.26), (NZ, 0.24)], 0, BY + 0.12, 28, M['metal']), 40)
smooth(lathe('tail_liner', [(NZ, 0.22), (-2.95, 0.18), (-2.85, 0.0)], 0, BY + 0.12, 24, M['carbon']), 60)
cyl('tail_hot', 0.17, 0.02, (0, BY + 0.12, -2.9), 'z', 20, M['hot'])
for sx in (-0.45, 0.45):
    box('belly_glow', (0.06, 0.012, 2.4), (sx, BY - 0.215, 0.6), material=M['glow'])

# Game hooks.
empty('nozzle_0', (-NX, NY, NZ)); empty('nozzle_1@0.45', (0, BY + 0.12, NZ)); empty('nozzle_2', (NX, NY, NZ))
empty('wingtip', (3.14, BY, -1.6))
empty('number@0.6', (NX + NR + 0.09, NY + 0.1, NF - 1.4))

out = os.environ.get('OUT', '/tmp')
print('TRIANGLES', tri_count()); tri_report()
export_glb(out + '/bulwark.glb')
if not os.environ.get('NORENDER'): render_views(out + '/bulwark')
finish()
