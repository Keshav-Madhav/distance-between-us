# BRUTE — from concept art/ships/concepts/brute-0.png. The heavy one: a near-square footprint of four
# big masses packed round a short, tall wedge cabin. Two front fan engines in rounded-square housings
# with orange rims; two taller rear box modules with lift fans on top and the main exhausts out the
# back; between front and rear a short, crammed engine bay (stages, pumps, gearbox canisters, clamped
# pipes); thick box beams tie the cabin to the modules; a wraparound bumper frame. Game frame: x right,
# y up, z forward.
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

def rsq(n=4.0, pts=32):
    """A rounded-square profile (superellipse), smooth enough to shade without facets."""
    out = []
    for i in range(pts):
        t = 2 * math.pi * i / pts; c, s = math.cos(t), math.sin(t)
        out.append((math.copysign(abs(c) ** (2 / n), c), math.copysign(abs(s) ** (2 / n), s)))
    return out
SQ, BOX = rsq(3.2), rsq(5.0)

FX, FY, FH = 2.0, 0.95, 0.84          # front engine centre, half size
RX, RY, RH = 2.05, 1.1, 0.92          # rear module centre, half size (taller)
F0, F1 = 4.0, 2.1                      # front housing z range
R0, R1 = 0.9, -1.95                    # rear module z range (shorter)
NZ = -2.45                             # exit plane
right = []

# ── Front engines.
right.append(poly_loft('front_house', [(F0, FX, FY, FH * 0.9, FH * 0.86, FH * 0.86), (F0 - 0.15, FX, FY, FH, FH * 0.95, FH * 0.93), (F1 + 0.4, FX, FY, FH, FH * 0.95, FH * 0.93), (F1, FX, FY, FH * 0.86, FH * 0.82, FH * 0.8)], SQ, 20, M['paint'], cap1=True, angle=50))
right.append(poly_loft('front_rim', [(F0 + 0.03, FX, FY, FH * 0.91, FH * 0.87, FH * 0.87), (F0 - 0.1, FX, FY, FH * 1.012, FH * 0.962, FH * 0.942), (F0 - 0.35, FX, FY, FH * 1.012, FH * 0.962, FH * 0.942)], SQ, 6, M['trim'], cap1=False, angle=50))
right.append(poly_loft('front_band', [(F1 + 0.75, FX, FY, FH * 1.008, FH * 0.958, FH * 0.938), (F1 + 0.5, FX, FY, FH * 1.008, FH * 0.958, FH * 0.938)], SQ, 3, M['trim'], cap1=False, angle=50))
right.append(smooth(lathe('front_duct', [(F0 + 0.02, 0.78), (F0 - 0.08, 0.7), (F0 - 0.3, 0.67), (F0 - 0.5, 0.66)], FX, FY, 40, M['carbon'], cap1=True), 60))
right.append(fan_smooth('front_fan', FX, FY, F0 - 0.4, 0.27, 0.65, 16, 0.85, 0.34, 5, M['gun']))
right.append(smooth(lathe('front_spinner', [(F0, 0.006), (F0 - 0.03, 0.07), (F0 - 0.1, 0.14), (F0 - 0.2, 0.21), (F0 - 0.28, 0.27), (F0 - 0.32, 0.3), (F0 - 0.6, 0.3), (F0 - 0.64, 0.28)], FX, FY, 48, M['gun'], cap1=True), 89))
right.append(cyl('fan_back', 0.64, 0.02, (FX, FY, F0 - 0.62), 'z', 36, M['carbon']))
right.append(ring('front_shroud', 0.665, 0.035, (FX, FY, F0 - 0.38), 36, M['carbon']))
right.append(box('marker', (0.03, 0.24, 0.14), (FX + FH + 0.01, FY - 0.2, F0 - 0.6), material=M['trim']))
for dz in (0.0, 0.2, 0.4):
    right.append(box('louvre', (0.05, 0.42, 0.09), (FX + FH, FY + 0.18, F1 + 1.3 - dz), (0.35, 0, 0), M['gun']))

# ── Rear modules: boxy, taller, a lift fan on top, the exhaust at the back.
right.append(poly_loft('rear_house', [(R0, RX, RY, RH * 0.86, RH * 0.86, RH * 0.84), (R0 - 0.22, RX, RY, RH, RH, RH * 0.97), (R1 + 0.3, RX, RY, RH, RH, RH * 0.97), (R1, RX, RY, RH * 0.88, RH * 0.88, RH * 0.85)], BOX, 20, M['paint'], cap1=True, angle=50))
right.append(poly_loft('rear_rim', [(R0 - 0.12, RX, RY, RH * 1.01, RH * 1.01, RH * 0.98), (R0 - 0.45, RX, RY, RH * 1.01, RH * 1.01, RH * 0.98)], BOX, 3, M['trim'], cap1=False, angle=50))
LT, LZ = RY + RH, (R0 + R1) / 2 - 0.15
CH = 0.2  # collar height above the lid
bm = bmesh.new(); segs = 40; rings = []
for (r, h) in [(0.74, -0.04), (0.74, CH * 0.8), (0.71, CH), (0.64, CH), (0.62, CH * 0.75), (0.62, -0.12)]:
    rings.append([bm.verts.new(G(RX + r * math.cos(2 * math.pi * j / segs), LT + h, LZ + r * math.sin(2 * math.pi * j / segs))) for j in range(segs)])
for A, B in zip(rings, rings[1:]):
    for j in range(segs):
        j1 = (j + 1) % segs; bm.faces.new((A[j], A[j1], B[j1], B[j]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
right.append(smooth(obj_from_bm('lift_collar', bm, M['paint']), 50))
right.append(cyl('lift_floor', 0.62, 0.03, (RX, LT - 0.1, LZ), 'y', 40, M['carbon']))
for i in range(16):
    a = 2 * math.pi * i / 16
    right.append(box('lift_blade', (0.06, 0.02, 0.42), (RX + 0.33 * math.cos(a), LT + 0.02, LZ + 0.33 * math.sin(a)), (0.35, -a + math.pi / 2, 0), M['gun']))
right.append(cyl('lift_hub', 0.13, 0.14, (RX, LT - 0.06, LZ), 'y', 20, M['metal']))
bpy.ops.mesh.primitive_torus_add(major_radius=0.685, minor_radius=0.04, major_segments=40, minor_segments=5)
t = bpy.context.active_object; t.name = 'lift_rim'; t.location = G(RX, LT + CH, LZ); bpy.ops.object.transform_apply(location=True)
t.data.materials.append(M['trim']); right.append(smooth(t, 60))
# Side face detail: a panel of vents and an access hatch handle on the outer flank.
SX = RX + RH          # outer face
right.append(box('access_panel', (0.06, 0.6, 0.9), (SX - 0.01, RY + 0.15, R0 - 1.0), material=M['gun'], bevel=0.02))
for dz in (-0.3, 0.3):
    right.append(box('panel_bolt', (0.05, 0.06, 0.06), (SX + 0.02, RY + 0.4, R0 - 1.0 + dz), material=M['metal']))
right.append(box('grille', (0.06, 0.42, 0.62), (SX - 0.0, RY - 0.4, R1 + 0.6), material=M['carbon'], bevel=0.02))
for dz in (-0.2, -0.07, 0.06, 0.19):
    right.append(box('grille_slat', (0.07, 0.4, 0.04), (SX + 0.01, RY - 0.4, R1 + 0.6 + dz), material=M['gun']))
# Exhaust.
right.append(smooth(lathe('nozzle', [(R1 + 0.05, 0.6), (R1 - 0.1, 0.64), (NZ + 0.12, 0.62), (NZ, 0.56), (NZ + 0.05, 0.5)], RX, RY, 40, M['metal']), 35))
right.append(smooth(lathe('nozzle_in', [(NZ + 0.05, 0.5), (R1 - 0.1, 0.46), (R1 + 0.1, 0.4)], RX, RY, 32, M['carbon']), 50))
for z, r in ((NZ + 0.3, 0.44), (NZ + 0.48, 0.38)):
    right.append(ring('turbine', r, 0.03, (RX, RY, z), 28, M['gun']))
right.append(cyl('hot', 0.36, 0.02, (RX, RY, R1 + 0.05), 'z', 28, M['hot']))
right.append(ring('nozzle_band', 0.65, 0.035, (RX, RY, R1 - 0.12), 32, M['trim']))

# ── Engine bay between front and rear: short and crammed.
MX, MY = 2.0, 0.98
right.append(smooth(lathe('core', [(F1 + 0.05, 0.56), (F1 - 0.05, 0.6), (R0 + 0.05, 0.6), (R0 - 0.05, 0.56)], MX, MY, 28, M['gun']), 40))
for (z0, z1, r, m) in [(F1 - 0.1, F1 - 0.4, 0.74, 'brass'), (F1 - 0.55, F1 - 0.75, 0.7, 'gun')]:
    right.append(smooth(lathe('stage', [(z0, r * 0.94), (z0 - 0.03, r), (z1 + 0.03, r), (z1, r * 0.94)], MX, MY, 28, M[m], cap0=True, cap1=True), 40))
    for z in (z0 - 0.02, z1 + 0.02):
        right.append(ring('flange', r + 0.01, 0.025, (MX, MY, z), 22, M['metal'], minor=4))
# Gearbox canisters standing on top (white, orange caps), a pump block on the outside, a manifold below.
for (dx, dz, h) in [(-0.2, F1 - 0.35, 0.42), (0.25, F1 - 0.75, 0.34)]:
    right.append(cyl('gearbox', 0.16, h, (MX + dx, MY + 0.66 + h / 2, dz), 'y', 18, M['paint']))
    right.append(cyl('gearbox_cap', 0.17, 0.06, (MX + dx, MY + 0.66 + h, dz), 'y', 18, M['trim']))
right.append(box('pump', (0.34, 0.5, 0.7), (MX + 0.72, MY + 0.05, (F1 + R0) / 2), material=M['gun'], bevel=0.04))
right.append(cyl('pump_motor', 0.14, 0.5, (MX + 0.92, MY + 0.05, (F1 + R0) / 2), 'z', 14, M['metal']))
for (dx, dy, r) in [(0.62, -0.4, 0.16), (-0.62, 0.3, 0.14), (0.55, 0.45, 0.12)]:  # tanks packed round the core
    right.append(cyl('tank', r, F1 - R0 - 0.1, (MX + dx, MY + dy, (F1 + R0) / 2), 'z', 16, M['metal']))
    for z in (F1 - 0.15, R0 + 0.15):
        right.append(cyl('tank_band', r * 1.08, 0.07, (MX + dx, MY + dy, z), 'z', 16, M['trim']))
right.append(box('compressor', (0.5, 0.32, 0.6), (MX - 0.15, MY + 0.72, (F1 + R0) / 2), material=M['gun'], bevel=0.04))
for k in range(3):  # a bundle of pipes on the inner side
    right.append(tube('bundle', [(MX - 0.7, MY - 0.2 + k * 0.1, F1 + 0.1), (MX - 0.74, MY - 0.2 + k * 0.1, (F1 + R0) / 2), (MX - 0.7, MY - 0.2 + k * 0.1, R0 - 0.1)], 0.035, M['brass' if k == 1 else 'trim']))
right.append(box('valve', (0.18, 0.2, 0.2), (MX + 0.78, MY + 0.05, (F1 + R0) / 2 - 0.3), material=M['gun'], bevel=0.02))
right.append(box('manifold', (0.6, 0.18, 0.9), (MX, MY - 0.7, (F1 + R0) / 2), material=M['carbon'], bevel=0.03))
for (a, col) in [(2.3, 'trim'), (3.4, 'brass'), (4.6, 'trim')]:  # pipes tight to the core, clamped at both ends
    pts = [(MX + 0.66 * math.cos(a), MY + 0.66 * math.sin(a), z) for z in (F1 + 0.05, (F1 + R0) / 2, R0 - 0.05)]
    right.append(tube('pipe', pts, 0.05, M[col]))
    for z in (F1 - 0.02, R0 + 0.02):
        right.append(cyl('clamp', 0.08, 0.07, (MX + 0.66 * math.cos(a), MY + 0.66 * math.sin(a), z), 'z', 10, M['gun']))

# ── Thick box beams from the cabin to the modules (at the front housing, the bay and the rear module).
for (z, y, d) in [((F1 + R0) / 2, 0.92, 0.5), (R1 + 1.2, 1.0, 0.9)]:
    right.append(box('beam', (1.0, 0.42, d), (1.35, y, z), material=M['gun'], bevel=0.05))

# Shoulders: the hull's upper flank reaching out to the modules over the bay.
right.append(poly_loft('shoulder', [(3.95, 1.15, 1.4, 0.05, 0.05, 0.05), (3.6, 1.18, 1.46, 0.3, 0.12, 0.2), (-1.2, 1.18, 1.5, 0.3, 0.12, 0.2), (-1.8, 1.15, 1.46, 0.05, 0.05, 0.05)],
                         [(1, 0), (0.6, 1), (-1, 1), (-1, -1), (0.6, -0.6)], 30, M['paint'], angle=50))

join_mirror(right)

# ── Cabin: a tall faceted wedge, as tall as the modules, pressed against them.
HEX = [(1.0, 0.0), (0.86, 0.6), (0.5, 0.95), (0.0, 1.0), (-0.5, 0.95), (-0.86, 0.6), (-1.0, 0.0), (-0.8, -0.6), (-0.4, -0.95), (0.0, -1.0), (0.4, -0.95), (0.8, -0.6)]
CAB = [(4.92, 0, 0.62, 0.05, 0.02, 0.03), (4.86, 0, 0.62, 0.2, 0.07, 0.09), (4.76, 0, 0.63, 0.35, 0.12, 0.16), (4.6, 0, 0.64, 0.46, 0.16, 0.22), (3.9, 0, 0.86, 0.94, 0.66, 0.4), (2.6, 0, 1.02, 1.12, 1.08, 0.5), (0.6, 0, 1.06, 1.14, 1.18, 0.52),
       (-0.9, 0, 1.04, 1.12, 1.08, 0.52), (-1.9, 0, 0.98, 0.94, 0.86, 0.46), (-2.4, 0, 0.94, 0.64, 0.56, 0.4)]
poly_loft('cabin', CAB, HEX, 48, M['paint'], angle=52)
_zs = sorted(c[0] for c in CAB); _top = _mono_cubic(_zs, [next(c[2] + c[4] for c in CAB if c[0] == z) for z in _zs])
poly_loft('stripe', [(z, 0, _top(z) + 0.006, 0.22, 0.012, 0.012) for z in (-2.3, -1.6, -0.9, -0.2)], [(1, 0), (0.95, 1), (-0.95, 1), (-1, 0), (-0.95, -1), (0.95, -1)], 20, M['trim'], cap1=True, angle=80)
# Canopy: a raised faceted glass house with a frame.
TOP = _top(1.6)
poly_loft('canopy', [(2.9, 0, TOP - 0.05, 0.08, 0.04, 0.02), (2.5, 0, TOP - 0.05, 0.42, 0.24, 0.02), (1.6, 0, TOP - 0.05, 0.54, 0.4, 0.02), (0.5, 0, TOP - 0.05, 0.5, 0.38, 0.02), (0.1, 0, TOP - 0.05, 0.08, 0.04, 0.02)],
          [(math.cos(t), math.sin(t) ** 0.8 if t <= math.pi else -0.3) for t in [i * math.pi / 14 for i in range(15)]] + [(0.0, -1.0)], 28, M['glass'], angle=70)
smooth_loft('canopy_frame', [(3.0, 0, TOP - 0.06, 0.1, 0.12, 0.03, 2.4), (2.5, 0, TOP - 0.06, 0.46, 0.13, 0.03, 2.4), (1.6, 0, TOP - 0.06, 0.58, 0.14, 0.03, 2.4), (0.5, 0, TOP - 0.06, 0.54, 0.13, 0.03, 2.4), (0.0, 0, TOP - 0.06, 0.1, 0.12, 0.03, 2.4)], 24, 24, M['gun'])
for side in (1, -1):
    for dz in (0.0, 0.18, 0.36):
        box('cab_vent', (0.05, 0.3, 0.09), (side * 1.13, 1.2, -0.5 - dz), (0.3, 0, 0), M['gun'])
# Rear deck: stacked pipes and a pump block on the cabin's back.
RD = _top(-1.2)
box('deck_block', (0.7, 0.2, 0.7), (0, RD + 0.02, -1.0), material=M['gun'], bevel=0.03)
cyl('deck_tank', 0.12, 0.62, (0, RD + 0.24, -1.0), 'x', 14, M['metal'])
for dx in (-0.25, 0.25):
    box('deck_saddle', (0.08, 0.18, 0.2), (dx, RD + 0.18, -1.0), material=M['gun'])
# Tail: a centre exhaust housing, recessed thruster.
smooth(lathe('tail_housing', [(-2.0, 0.48), (-2.25, 0.46), (-2.3, 0.4)], 0, 0.94, 40, M['gun']), 40)
smooth(lathe('tail_nozzle', [(-2.3, 0.32), (-2.4, 0.34), (NZ, 0.32)], 0, 0.94, 40, M['metal']), 40)
smooth(lathe('tail_liner', [(NZ, 0.3), (-2.36, 0.26), (-2.26, 0.22)], 0, 0.94, 32, M['carbon']), 50)
cyl('tail_hot', 0.22, 0.02, (0, 0.94, -2.27), 'z', 24, M['hot'])

# ── Bumper: a U-frame from under each front housing, round the nose.
for sx in (1, -1):
    tube('bumper_mount', [(sx * (FX - 0.4), FY - FH + 0.05, F1 + 0.6), (sx * (FX - 0.5), 0.2, F0 + 0.2)], 0.08, M['gun'])
def catmull(ps, n=10):
    out = []
    P = [ps[0]] + ps + [ps[-1]]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t ** 3) for j in range(3)))
    out.append(ps[-1]); return out
tube('bumper', catmull([(FX - 0.5, 0.2, F0 + 0.2), (FX - 0.6, 0.18, F0 + 0.75), (1.0, 0.18, F0 + 0.95), (-1.0, 0.18, F0 + 0.95), (-FX + 0.6, 0.18, F0 + 0.75), (-FX + 0.5, 0.2, F0 + 0.2)]), 0.09, M['gun'], seg=12)
for sx in (1, -1):
    tube('bumper_post', [(sx * 0.6, 0.18, F0 + 0.95), (sx * 0.38, 0.6, 4.3)], 0.08, M['gun'])
    box('post_mount', (0.2, 0.08, 0.2), (sx * 0.38, 0.62, 4.3), material=M['gun'])
box('bumper_glow', (1.8, 0.012, 0.06), (0, 0.1, F0 + 0.95), material=M['glow'])
for sx in (1, -1):  # hover glow: slim strips under each module
    for dx in (-0.4, 0.4):
        box('pad_glow', (0.06, 0.012, 1.4), (sx * (FX + dx), FY - FH * 0.93 - 0.01, (F0 + F1) / 2), material=M['glow'])
        box('pad_glow', (0.06, 0.012, 2.6), (sx * (RX + dx), RY - RH * 0.97 - 0.01, (R0 + R1) / 2), material=M['glow'])

# Game hooks.
empty('nozzle_0', (-RX, RY, NZ)); empty('nozzle_1@0.5', (0, 0.94, NZ)); empty('nozzle_2', (RX, RY, NZ))
empty('wingtip', (RX + RH, RY + 0.3, R1 + 0.3))
empty('number', (RX + RH + 0.01, RY - 0.25, R0 - 1.0))

out = os.environ.get('OUT', '/tmp')
print('TRIANGLES', tri_count()); tri_report()
export_glb(out + '/brute.glb')
if not os.environ.get('NORENDER'): render_views(out + '/brute')
finish()
