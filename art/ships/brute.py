# BRUTE — from concept art/ships/concepts/brute-0.png. A heavy four-module crawler: two big front fan
# engines in rounded-square housings with orange rims; two rear box modules with lift fans facing up
# and the main exhausts out the back; exposed machinery between front and rear modules; a faceted
# wedge cabin with an orange centre stripe and a multi-pane canopy; a tubular bumper frame round the
# nose. Game frame: x right, y up, z forward. Exhausts end on one exit plane.
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from lib import *

reset()
M = {k: mat(k, *v) for k, v in {
    'paint': ((0.86, 0.87, 0.88), 0.1, 0.35), 'trim': ((0.95, 0.42, 0.1), 0.2, 0.4),
    'carbon': ((0.16, 0.17, 0.19), 0.4, 0.5), 'metal': ((0.62, 0.64, 0.68), 1.0, 0.3),
    'glass': ((0.06, 0.08, 0.11), 0.3, 0.08), 'gun': ((0.23, 0.25, 0.28), 0.8, 0.34),
    'brass': ((0.72, 0.53, 0.23), 0.9, 0.3)}.items()}
M['glow'] = mat('glow', (0.4, 0.85, 1.0), 0, 0.3, emit=(0.4, 0.85, 1.0))
M['hot'] = mat('hot', (1.0, 0.55, 0.2), 0, 0.3, emit=(1.0, 0.55, 0.2))

FX, FY = 1.72, 0.82     # front engine centre
RX, RY = 1.78, 0.86     # rear module centre
NZ = -4.2
SQ = [(1.0, 0.0), (0.92, 0.62), (0.62, 0.92), (0.0, 1.0), (-0.62, 0.92), (-0.92, 0.62), (-1.0, 0.0), (-0.92, -0.62), (-0.62, -0.92), (0.0, -1.0), (0.62, -0.92), (0.92, -0.62)]
right = []

# ── Front engines: a rounded-square housing, open at the front, orange rim, a fan inside.
right.append(poly_loft('front_house', [(5.3, FX, FY, 0.62, 0.58, 0.58), (5.15, FX, FY, 0.68, 0.64, 0.64), (3.4, FX, FY, 0.7, 0.66, 0.64), (2.7, FX, FY, 0.6, 0.56, 0.56)], SQ, 24, M['paint'], cap1=True, angle=50))
right.append(poly_loft('front_rim', [(5.33, FX, FY, 0.63, 0.59, 0.59), (5.2, FX, FY, 0.69, 0.65, 0.65), (4.95, FX, FY, 0.69, 0.65, 0.65)], SQ, 6, M['trim'], cap1=False, angle=50))
right.append(poly_loft('front_band', [(3.75, FX, FY, 0.705, 0.665, 0.645), (3.5, FX, FY, 0.705, 0.665, 0.645)], SQ, 3, M['trim'], cap1=False, angle=50))
right.append(smooth(lathe('front_duct', [(5.3, 0.55), (5.0, 0.53), (4.8, 0.52)], FX, FY, 32, M['carbon'], cap1=True), 60))
right.append(fan_smooth('front_fan', FX, FY, 4.95, 0.17, 0.51, 18, 0.7, 0.28, 5, M['gun']))
right.append(smooth(lathe('front_spinner', [(5.25, 0.0), (5.2, 0.07), (5.1, 0.14), (4.98, 0.17), (4.88, 0.17)], FX, FY, 32, M['metal'], cap1=True), 80))
right.append(ring('front_shroud', 0.52, 0.03, (FX, FY, 4.95), 32, M['carbon']))
# Orange side marker and a vent block on each housing's outer side.
right.append(box('marker', (0.03, 0.2, 0.12), (FX + 0.7, FY - 0.12, 4.6), material=M['trim']))
for dz in (0.0, 0.2, 0.4):
    right.append(box('louvre', (0.04, 0.32, 0.08), (FX + 0.69, FY + 0.12, 3.2 - dz), (0.35, 0, 0), M['gun']))

# ── Rear modules: boxy housings with a lift fan on top and the main exhaust at the back.
right.append(poly_loft('rear_house', [(-0.5, RX, RY, 0.66, 0.62, 0.6), (-0.7, RX, RY, 0.72, 0.68, 0.64), (-3.2, RX, RY, 0.72, 0.68, 0.64), (-3.5, RX, RY, 0.64, 0.6, 0.58)], SQ, 24, M['paint'], cap1=True, angle=50))
right.append(poly_loft('rear_rim', [(-0.6, RX, RY, 0.725, 0.685, 0.645), (-0.95, RX, RY, 0.725, 0.685, 0.645)], SQ, 3, M['trim'], cap1=False, angle=50))
# Lift fan (axis up): a dark well, blades, an orange rim on the housing's flat top.
LT = RY + 0.68
lf = (RX, LT, -2.0)
right.append(cyl('lift_well', 0.5, 0.05, (lf[0], LT - 0.03, lf[2]), 'y', 28, M['carbon']))
for i in range(14):
    a = 2 * math.pi * i / 14
    right.append(box('lift_blade', (0.04, 0.02, 0.36), (lf[0] + 0.24 * math.cos(a), LT + 0.005, lf[2] + 0.24 * math.sin(a)), (0, -a + math.pi / 2, 0), M['gun']))
right.append(cyl('lift_hub', 0.11, 0.06, (lf[0], LT + 0.01, lf[2]), 'y', 16, M['metal']))
bpy.ops.mesh.primitive_torus_add(major_radius=0.53, minor_radius=0.04, major_segments=28, minor_segments=5)
t = bpy.context.active_object; t.name = 'lift_rim'; t.location = G(lf[0], LT, lf[2]); bpy.ops.object.transform_apply(location=True)
t.data.materials.append(M['trim']); right.append(smooth(t, 60))
# Main exhaust: a flared nozzle out of the module's back, petals, hot core.
right.append(smooth(lathe('nozzle', [(-3.45, 0.46), (-3.6, 0.5), (-3.95, 0.48), (-4.05, 0.44)], RX, RY, 32, M['metal']), 30))
right.append(petals('petals', RX, RY, -4.0, 0.44, 10, 0.24, 0.2, -0.2, 0.014, M['gun']))
right.append(cyl('hot', 0.34, 0.02, (RX, RY, -3.75), 'z', 28, M['hot']))
right.append(ring('nozzle_band', 0.5, 0.03, (RX, RY, -3.7), 28, M['trim']))

# ── Exposed machinery between front and rear modules: a core shaft with stages, canisters, pipes.
MX, MY = 1.72, 0.8
right.append(smooth(lathe('core', [(2.75, 0.42), (2.5, 0.44), (-0.45, 0.44), (-0.6, 0.42)], MX, MY, 28, M['gun']), 40))
for (z0, z1, r, m) in [(2.4, 2.0, 0.56, 'gun'), (1.7, 1.2, 0.52, 'brass'), (0.9, 0.6, 0.58, 'gun'), (0.3, -0.25, 0.5, 'brass')]:
    right.append(smooth(lathe('stage', [(z0, r * 0.94), (z0 - 0.03, r), (z1 + 0.03, r), (z1, r * 0.94)], MX, MY, 28, M[m], cap0=True, cap1=True), 40))
    for z in (z0 - 0.02, z1 + 0.02):
        right.append(ring('flange', r + 0.01, 0.022, (MX, MY, z), 22, M['metal'], minor=4))
for (a, z0, z1, rr) in [(0.5, 2.3, 0.6, 0.13), (-0.6, 1.9, -0.3, 0.12), (2.3, 2.2, 0.9, 0.1)]:
    x, y = MX + (0.58 + rr) * math.cos(a), MY + (0.58 + rr) * math.sin(a)
    right.append(cyl('canister', rr, z0 - z1, (x, y, (z0 + z1) / 2), 'z', 12, M['metal']))
    for z in (z0 - 0.06, z1 + 0.06):
        right.append(cyl('canister_cap', rr * 1.1, 0.07, (x, y, z), 'z', 12, M['trim']))
    for z in (z0 - 0.3, z1 + 0.3):
        right.append(box('saddle', (0.14, rr + 0.18, 0.14), (MX + (0.5 + rr / 2) * math.cos(a), MY + (0.5 + rr / 2) * math.sin(a), z), (0, 0, a - math.pi / 2), M['gun']))
for j, a in enumerate((1.4, 3.6, 5.0)):
    pts = [(MX + (0.6 + 0.05 * math.sin(q + j)) * math.cos(a + 0.15 * math.sin(q * 0.6)), MY + (0.6 + 0.05 * math.sin(q + j)) * math.sin(a + 0.15 * math.sin(q * 0.6)), 2.7 - q * 0.16) for q in range(21)]
    right.append(tube('pipe', pts, 0.045, M['trim'] if j != 1 else M['metal']))
# Frame rails tying front housing to rear module (top and bottom), so the machinery sits in a cage.
for (dy, dx) in [(0.62, 0.0), (-0.6, 0.15)]:
    right.append(tube('rail', [(FX + dx, FY + dy, 2.8), (MX + dx, MY + dy + 0.04, 1.0), (RX + dx, RY + dy, -0.6)], 0.06, M['gun']))

# ── Struts from the cabin to the modules (dark tubular frame).
for (z, y) in [(3.6, 0.85), (2.4, 0.7), (-1.4, 0.8), (-2.6, 0.75)]:
    right.append(tube('strut', [(0.62, y + 0.05, z), (1.05, y, z - 0.25), (FX - 0.64, y, z - 0.35)], 0.07, M['gun']))

join_mirror(right)

# ── Cabin: a faceted wedge, wide and low, its nose dropping to the bumper.
HEX = [(1.0, 0.0), (0.86, 0.6), (0.5, 0.95), (0.0, 1.0), (-0.5, 0.95), (-0.86, 0.6), (-1.0, 0.0), (-0.8, -0.6), (-0.4, -0.95), (0.0, -1.0), (0.4, -0.95), (0.8, -0.6)]
CAB = [(5.0, 0, 0.62, 0.32, 0.12, 0.2), (4.2, 0, 0.7, 0.62, 0.36, 0.3), (2.6, 0, 0.8, 0.74, 0.62, 0.36), (0.6, 0, 0.84, 0.78, 0.66, 0.38),
       (-1.6, 0, 0.84, 0.78, 0.6, 0.38), (-3.3, 0, 0.82, 0.66, 0.48, 0.34), (-4.0, 0, 0.8, 0.46, 0.34, 0.3)]
poly_loft('cabin', CAB, HEX, 56, M['paint'])
# Orange centre stripe along the flat top (a hair proud), black stripe edges.
poly_loft('stripe', [(z, 0, cy + t + 0.004, 0.2, 0.012, 0.012) for (z, cx, cy, a, t, b) in CAB[1:-1] if not (0.3 < z < 2.7)], [(1, 0), (0.95, 1), (-0.95, 1), (-1, 0), (-0.95, -1), (0.95, -1)], 30, M['trim'], cap1=True, angle=80)
# Canopy: a multi-pane faceted glass house on the cabin's front top, framed.
TOP = 0.8 + 0.64
glass = poly_loft('canopy', [(2.9, 0, TOP - 0.04, 0.05, 0.02, 0.02), (2.5, 0, TOP - 0.04, 0.46, 0.18, 0.02), (1.5, 0, TOP - 0.04, 0.6, 0.34, 0.02), (0.5, 0, TOP - 0.04, 0.56, 0.32, 0.02), (0.1, 0, TOP - 0.04, 0.05, 0.02, 0.02)],
                  [(1.0, 0.0), (0.75, 0.8), (0.3, 1.0), (-0.3, 1.0), (-0.75, 0.8), (-1.0, 0.0), (0.0, -1.0)], 30, M['glass'], angle=20)
for z in (2.2, 1.5, 0.8):  # pane frames
    k = 1.0 if 0.7 < z < 2.3 else 0.8
    tube('pane', [(0.58 * k, TOP - 0.02, z), (0.44 * k, TOP + 0.27 * k, z), (0.17, TOP + 0.33 * k, z), (-0.17, TOP + 0.33 * k, z), (-0.44 * k, TOP + 0.27 * k, z), (-0.58 * k, TOP - 0.02, z)], 0.025, M['gun'])
tube('pane_spine', [(0, TOP + 0.2, 2.6), (0, TOP + 0.33, 1.5), (0, TOP + 0.3, 0.4)], 0.025, M['gun'])
# Cabin tail thruster (small), recessed.
smooth(lathe('tail_nozzle', [(-3.95, 0.26), (-4.12, 0.28), (-4.2, 0.26)], 0, 0.8, 24, M['metal']), 40)
smooth(lathe('tail_liner', [(-4.2, 0.24), (-4.08, 0.21), (-3.98, 0.18)], 0, 0.8, 24, M['carbon']), 50)
cyl('tail_hot', 0.17, 0.02, (0, 0.8, -3.99), 'z', 20, M['hot'])
# Vents on the cabin flanks behind the canopy.
for side in (1, -1):
    for dz in (0.0, 0.18, 0.36):
        box('cab_vent', (0.04, 0.22, 0.08), (side * 0.77, 0.98, -0.6 - dz), (0.3, 0, 0), M['gun'])

# ── Bumper frame round the nose: a tubular U from the front housings' lower inner corners.
tube('bumper', [(FX - 0.5, 0.25, 5.1), (1.0, 0.22, 5.9), (0.5, 0.22, 6.1), (-0.5, 0.22, 6.1), (-1.0, 0.22, 5.9), (-FX + 0.5, 0.25, 5.1)], 0.07, M['gun'])
for sx in (1, -1):
    tube('bumper_post', [(sx * 0.55, 0.22, 6.05), (sx * 0.4, 0.55, 5.0)], 0.05, M['gun'])
    tube('bumper_leg', [(sx * 1.05, 0.22, 5.85), (sx * 1.2, 0.3, 5.2)], 0.05, M['gun'])
box('skid_glow', (2.0, 0.012, 0.08), (0, 0.15, 6.05), material=M['glow'])
for sx in (1, -1):  # hover glow under each module
    box('pad_glow', (0.9, 0.012, 1.8), (sx * FX, FY - 0.66, 4.0), material=M['glow'])
    box('pad_glow', (0.9, 0.012, 2.0), (sx * RX, RY - 0.65, -2.0), material=M['glow'])

# Game hooks.
empty('nozzle_0', (-RX, RY, NZ)); empty('nozzle_1@0.4', (0, 0.8, NZ)); empty('nozzle_2', (RX, RY, NZ))
empty('wingtip', (RX + 0.72, RY + 0.3, -3.0))
empty('number', (RX + 0.73, RY - 0.05, -1.3))

out = os.environ.get('OUT', '/tmp')
print('TRIANGLES', tri_count()); tri_report()
export_glb(out + '/brute.glb')
if not os.environ.get('NORENDER'): render_views(out + '/brute')
finish()
