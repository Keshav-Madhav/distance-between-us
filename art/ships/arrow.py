# ARROW — from concept art/ships/concepts/arrow-0.png. Twin white engine cans with fan intakes and an
# orange band; behind each can the turbine machinery is exposed (rings, ribs, pipes, actuators) down
# to a spiked nozzle. A narrow nose body runs between the intakes back to a pod with a long dark
# canopy on a wide flat spine; tapered pylons tie it to the engines; swept fins at the back;
# hover glow underneath. Game frame: x right, y up, z forward.
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from lib import *
from lib import _mono_cubic

reset()
M = {k: mat(k, *v) for k, v in {
    'paint': ((0.86, 0.87, 0.88), 0.1, 0.35), 'trim': ((0.95, 0.42, 0.1), 0.2, 0.4),
    'carbon': ((0.16, 0.17, 0.19), 0.4, 0.5), 'metal': ((0.62, 0.64, 0.68), 1.0, 0.3),
    'glass': ((0.06, 0.08, 0.11), 0.3, 0.08), 'gun': ((0.23, 0.25, 0.28), 0.8, 0.34), 'brass': ((0.72, 0.53, 0.23), 0.9, 0.3)}.items()}
M['glow'] = mat('glow', (0.4, 0.85, 1.0), 0, 0.3, emit=(0.4, 0.85, 1.0))
M['hot'] = mat('hot', (1.0, 0.55, 0.2), 0, 0.3, emit=(1.0, 0.55, 0.2))

EX, EY, NZ = 1.78, 0.78, -4.2
CR = 1.4  # where the white can ends and the machinery begins (moved forward: the cans were too long)
def MZ(z):  # machinery stations authored for a can ending at 0.7, stretched to start at CR
    return -2.6 + (z + 2.6) * (CR + 2.6) / 3.3
right = []  # right-side parts, mirrored at the end

# ── Engine can: one lathe profile, split by material along its length so the orange band is part of
# the same skin (same rings, no step).
lip = [(6.0, 0.6), (6.04, 0.66), (6.0, 0.72), (5.85, 0.745)]
right.append(smooth(lathe('can_lip', lip + [(5.78, 0.75)], EX, EY, 56, M['paint']), 30))
right.append(smooth(lathe('can_lipband', [(5.78, 0.75), (5.7, 0.75)], EX, EY, 56, M['trim']), 30))
right.append(smooth(lathe('can_lip2', [(5.7, 0.75), (5.6, 0.75)], EX, EY, 56, M['paint']), 30))
right.append(smooth(lathe('can_band0', [(5.6, 0.75), (5.15, 0.75)], EX, EY, 56, M['trim']), 30))
right.append(smooth(lathe('can_front', [(5.15, 0.75), (4.6, 0.75), (3.62, 0.748)], EX, EY, 56, M['paint']), 30))
right.append(smooth(lathe('can_seam', [(3.62, 0.748), (3.6, 0.735), (3.52, 0.735), (3.5, 0.748)], EX, EY, 56, M['gun']), 30))
right.append(smooth(lathe('can_mid', [(3.5, 0.748), (CR + 0.95, 0.74)], EX, EY, 56, M['paint']), 30))
# A faired sensor blister on the can's top, and a vent pair on its inboard flank.
right.append(smooth_loft('blister', [(4.9, EX, EY + 0.72, 0.03, 0.02, 0.02, 2), (4.6, EX, EY + 0.72, 0.13, 0.09, 0.04, 2.4), (3.9, EX, EY + 0.72, 0.13, 0.08, 0.04, 2.4), (3.75, EX, EY + 0.72, 0.03, 0.02, 0.02, 2)], 16, 12, M['paint']))
right.append(cyl('blister_lens', 0.045, 0.02, (EX, EY + 0.8, 4.75), 'y', 12, M['glass']) if False else box('blister_lens', (0.12, 0.02, 0.1), (EX, EY + 0.795, 4.6), material=M['glass']))
for dz in (0.0, 0.22):
    right.append(box('vent_in', (0.03, 0.3, 0.12), (EX - 0.745, EY + 0.1, 2.9 - dz), (0, 0, 0), M['carbon']))
# Paired vent slots near the rear band (skin detail, sparse).
for a in (1.05, 1.25):
    right.append(box('vent_slot', (0.05, 0.03, 0.4), (EX + 0.742 * math.cos(a), EY + 0.742 * math.sin(a), CR + 1.4), (0, 0, a - math.pi / 2), M['carbon']))

right.append(smooth(lathe('can_band', [(CR + 0.95, 0.74), (CR + 0.35, 0.735)], EX, EY, 56, M['trim']), 30))
right.append(smooth(lathe('can_rear', [(CR + 0.35, 0.735), (CR + 0.05, 0.73), (CR, 0.69)], EX, EY, 56, M['paint']), 30))
right.append(ring('can_rim', 0.7, 0.03, (EX, EY, CR), 40, M['metal']))
# Intake: a dark duct, a fan of blades, a spinner.
right.append(smooth(lathe('duct', [(6.0, 0.6), (5.7, 0.59), (5.4, 0.58)], EX, EY, 32, M['carbon'], cap1=True), 60))
right.append(fan_smooth('fan', EX, EY, 5.4, 0.285, 0.565, 14, 0.75, 0.34, 4, M['carbon']))
right.append(cyl('hub', 0.18, 0.06, (EX, EY, 5.42), 'z', 24, M['carbon']))
right.append(ring('fan_shroud', 0.575, 0.03, (EX, EY, 5.5), 40, M['carbon']))
for i in range(12):  # stator vanes behind the fan
    a = 2 * math.pi * i / 12
    right.append(box('stator', (0.38, 0.02, 0.06), (EX + 0.37 * math.cos(a), EY + 0.37 * math.sin(a), 5.3), (0, 0, a), M['gun']))
right.append(smooth(lathe('spinner', [(6.0, 0.006), (5.995, 0.03), (5.96, 0.07), (5.91, 0.11), (5.84, 0.155), (5.76, 0.19), (5.67, 0.22), (5.6, 0.25), (5.56, 0.27), (5.25, 0.27), (5.2, 0.25)], EX, EY, 48, M['gun'], cap1=True), 89))

# ── Exposed machinery behind the can: compressor stages of different diameters (grey housings and
# dark gaps), canisters strapped along the core, two thick orange feed pipes clamped close to it.
for k, (z0, z1, r, m) in enumerate([(MZ(0.7), MZ(0.45), 0.7, 'gun'), (MZ(0.45), MZ(0.05), 0.62, 'brass'), (MZ(0.05), MZ(-0.85), 0.72, 'gun'),
                       (MZ(-0.85), MZ(-1.05), 0.56, 'carbon'), (MZ(-1.05), MZ(-1.7), 0.66, 'brass'), (MZ(-1.7), MZ(-2.6), 0.54, 'carbon')]):
    right.append(smooth(lathe('stage', [(z0, r * 0.94), (z0 - 0.03, r), (z1 + 0.03, r), (z1, r * 0.94)], EX, EY, 26, M[m], cap0=True, cap1=True), 40))
    if m in ('gun', 'brass'):  # flange lips at both ends, and radial ribs on two stages
        for z in (z0 - 0.02, z1 + 0.02):
            right.append(ring('flange', r + 0.01, 0.025, (EX, EY, z), 20, M['metal'], minor=3))
        if k in (2,):
            for i in range(12):
                a = 2 * math.pi * (i + 0.5) / 12
                right.append(box('rib', (0.05, 0.05, abs(z1 - z0) - 0.1), (EX + (r + 0.02) * math.cos(a), EY + (r + 0.02) * math.sin(a), (z0 + z1) / 2), (0, 0, a - math.pi / 2), M['metal']))
# Cooling fins round the last band (it read as a missing mesh).
for i in range(20):
    a = 2 * math.pi * (i + 0.5) / 20
    right.append(box('cool_fin', (0.015, 0.13, 0.7), (EX + 0.6 * math.cos(a), EY + 0.6 * math.sin(a), MZ(-2.15)), (0, 0, a - math.pi / 2), M['gun']))
# Auxiliary cylinders on the outboard side only, of different sizes.
for (a, z0, z1, rr) in []:
    x, y = EX + (0.72 + rr) * math.cos(a), EY + (0.72 + rr) * math.sin(a)
    right.append(cyl('aux', rr, z0 - z1, (x, y, (z0 + z1) / 2), 'z', 14, M['brass']))
    for z in (z0 - 0.08, z1 + 0.08):
        right.append(cyl('aux_cap', rr * 1.08, 0.08, (x, y, z), 'z', 14, M['trim']))
    for z in (z0 - 0.3, z1 + 0.3):  # saddle brackets into the drum
        right.append(box('saddle', (0.16, rr + 0.2, 0.16), (EX + (0.7 + rr / 2) * math.cos(a), EY + (0.7 + rr / 2) * math.sin(a), z), (0, 0, a - math.pi / 2), M['gun']))
# Two thick orange feed pipes flush on the drum, clamps staggered.
# Feed lines: arcs from a brass fitting on one stage to a fitting on the next (not a noodle).
for j, a in enumerate((1.7, 2.55)):
    stations = [MZ(0.6), MZ(-0.4), MZ(-1.35), MZ(-2.2)]
    for k, (za, zb) in enumerate(zip(stations, stations[1:])):
        if (k + j) % 3 == 2: continue
        pts = []
        for q in range(9):
            u = q / 8; rr = 0.765
            pts.append((EX + rr * math.cos(a), EY + rr * math.sin(a), za + (zb - za) * u))
        right.append(tube('feed_pipe', pts, 0.05, M['trim']))
        for z in (za, zb):
            right.append(cyl('fitting', 0.07, 0.08, (EX + 0.75 * math.cos(a), EY + 0.75 * math.sin(a), z), 'z', 10, M['brass']))
# Thin copper coils wrapped round the brass stage.
right.append(tube('coil', [(EX + 0.66 * math.cos(t * 0.6), EY + 0.66 * math.sin(t * 0.6), MZ(0.4) - t * 0.012) for t in range(0, 60, 2)], 0.018, M['brass']))

# ── Nozzle: a flared metal can with a crown of petals ending on the exit plane; the hot core inside.
right.append(smooth(lathe('nozzle', [(-2.6, 0.5), (-2.9, 0.57), (-3.5, 0.55), (-3.75, 0.5)], EX, EY, 40, M['metal']), 30))
right.append(ring('nozzle_band', 0.565, 0.03, (EX, EY, -3.1), 40, M['trim']))
right.append(ring('crown_base', 0.5, 0.07, (EX, EY, -3.72), 40, M['gun']))
right.append(petals('petals', EX, EY, -3.7, 0.53, 12, 0.5, 0.21, -0.24, 0.014, M['metal']))
right.append(smooth(lathe('liner', [(-3.5, 0.48), (-3.7, 0.44), (-3.8, 0.0)], EX, EY, 32, M['carbon']), 60))
c = bpy.data.objects.get('liner')
right.append(cyl('hot_core', 0.4, 0.02, (EX, EY, -3.72), 'z', 32, M['hot']))

# ── Side vane (outboard of each engine) sweeping out into a fin at the back.
fin = plate('fin', [(0.0, 0.62), (0.0, 1.0), (-1.2, 1.26), (-1.5, 1.0), (-1.2, 0.66)], 0.2, M['paint'], 'x', 0.0, 0.06)
place(fin, (0, -0.3, 0), (EX + 0.84, 0.0, CR + 1.6)); right.append(fin)
right.append(poly_loft('talon_pylon', [(CR + 2.45, EX + 0.62, EY, 0.03, 0.05, 0.05), (CR + 1.75, EX + 0.74, EY + 0.03, 0.15, 0.24, 0.2), (CR + 0.95, EX + 0.78, EY + 0.03, 0.14, 0.22, 0.18), (CR + 0.4, EX + 0.7, EY + 0.03, 0.04, 0.08, 0.06)], [(1, 0), (0.3, 1), (-1, 0.7), (-1, -0.7), (0.3, -1)], 30, M['paint'], angle=60))
ft = plate('fin_tip', [(-1.12, 1.24), (-1.22, 1.27), (-1.52, 1.0), (-1.38, 0.98)], 0.22, M['trim'], 'x', 0.0, 0.05)
place(ft, (0, -0.3, 0), (EX + 0.84, 0.0, CR + 1.6)); right.append(ft)
# ── Skid rail along each can's lower outer side, faired into it; the hover glow under it.
# Rear fin root: a fairing and an actuator housing where the swept fin meets the engine.
right.append(poly_loft('fin_root', [(CR + 0.85, EX + 0.62, EY + 0.02, 0.02, 0.04, 0.04), (CR + 0.4, EX + 0.72, EY + 0.02, 0.2, 0.26, 0.22), (CR - 0.6, EX + 0.76, EY + 0.02, 0.2, 0.24, 0.2), (CR - 1.4, EX + 0.62, EY + 0.02, 0.02, 0.04, 0.04)], [(1, 0), (0.2, 0.35), (-1, 1.0), (-1, -1.0), (0.2, -0.35)], 36, M['paint'], angle=60))
right.append(cyl('fin_act', 0.05, 0.6, (EX + 0.78, EY + 0.28, CR - 0.3), 'z', 10, M['gun']))

# ── Pylons: spine to can.
for (zc, ch) in [(0.9, 1.1), (-1.7, 1.0)]:  # tapered pylons, spine to can, filleted both ends
    pl = smooth_loft('pylon', [(-0.98, 0, EY + 0.06, ch * 0.62, 0.15, 0.15, 2.0), (-0.85, 0, EY + 0.06, ch * 0.5, 0.09, 0.09, 2.0), (-0.6, 0, EY + 0.06, ch * 0.46, 0.08, 0.08, 2.0), (-0.42, 0, EY + 0.06, ch * 0.62, 0.15, 0.15, 2.0)], 16, 10, M['gun'], cap0=True, cap1=True)
    place(pl, (0, -math.pi / 2, 0), (0, 0, zc)); right.append(pl)

join_mirror(right)

# ── Centre spine: wide, flat-topped with chamfered sides, its top up on the engines' top line.
BODY_UNUSED = [
    (6.15, 0, 0.8, 0.12, 0.04, 0.04, 1.8),
    (5.4, 0, 0.82, 0.48, 0.24, 0.2, 2.6),
    (3.6, 0, 0.86, 0.6, 0.46, 0.26, 3.0),
    (1.2, 0, 0.9, 0.7, 0.58, 0.3, 3.2),
    (-0.8, 0, 0.9, 0.86, 0.6, 0.3, 3.2),
    (-2.6, 0, 0.88, 1.0, 0.56, 0.28, 3.2),
    (-3.6, 0, 0.86, 0.94, 0.46, 0.28, 3.0),
    (-4.1, 0, 0.84, 0.6, 0.3, 0.26, 2.6),
]
# Hard-chined section: a flat top, chamfers down to a sharp chine, a shallow hull below.
HEX = [(1.0, 0.0), (0.82, 0.55), (0.5, 0.92), (0.0, 1.0), (-0.5, 0.92), (-0.82, 0.55), (-1.0, 0.0), (-0.7, -0.55), (-0.3, -0.95), (0.0, -1.0), (0.3, -0.95), (0.7, -0.55)]
SPINE = [(6.2, 0, 0.8, 0.05, 0.03, 0.02), (5.4, 0, 0.82, 0.56, 0.16, 0.1), (3.6, 0, 0.84, 0.68, 0.38, 0.26), (1.2, 0, 0.9, 0.76, 0.56, 0.3),
         (-0.8, 0, 0.9, 0.88, 0.58, 0.3), (-2.6, 0, 0.88, 1.0, 0.56, 0.28), (-3.6, 0, 0.86, 0.94, 0.46, 0.28), (-4.1, 0, 0.84, 0.66, 0.3, 0.26)]
body = poly_loft('body', SPINE, HEX, 56, M['paint'])
# Chevron lines on the nose (livery, laid on the flat top).
_zs = sorted(r[0] for r in SPINE); _top = _mono_cubic(_zs, [next(r[2] + r[4] for r in SPINE if r[0] == z) for z in _zs])
for dz in (0.0, 0.55):
    z0 = 5.1 - dz
    tube('chevron', [(-0.36, _top(z0 - 0.6) + 0.02, z0 - 0.6), (0, _top(z0) + 0.025, z0), (0.36, _top(z0 - 0.6) + 0.02, z0 - 0.6)], 0.045, M['trim'])
# An orange stripe along each chine, a dark keel plate under the hull.
poly_loft('keel', [(z, 0, cy - b - 0.01, a * 0.32, 0.03, 0.03) for (z, cx, cy, a, t, b) in SPINE[1:-1]], [(1, 0), (0.6, 1), (-0.6, 1), (-1, 0), (-0.6, -1), (0.6, -1)], 40, M['carbon'], cap1=True)
# Canopy: a big smoked oval over the middle of the spine, orange frame lines across it.
TOP = 1.46
CZ, CL, CW, CH = 2.3, 2.2, 0.62, 0.5   # canopy centre, half length, half width, height (forward, raised)
TOP = 1.5
def egg(scale_w, scale_h, base, z_pad=0.0, n=14):
    st = []
    for i in range(n + 1):
        f = -1 + 2 * i / n; k = math.sqrt(max(0.0, 1 - f * f)) ** 0.8
        st.append((CZ + f * (CL + z_pad), 0, base, max(0.03, CW * scale_w * k), max(0.02, CH * scale_h * k), 0.03, 2.2))
    return st
# Skirt: a white fairing from the spine up to the canopy sill (one solid shape in side view).
smooth_loft('canopy_skirt', [(z, 0, 1.26, a * 1.08, TOP - 1.26 + 0.02, 0.05, 2.6) for (z, cx, cy, a, t, b, n) in egg(1.0, 1.0, TOP, 0.25)], 24, 22, M['paint'])
frame = smooth_loft('canopy_frame', [(z, 0, TOP - 0.03, a * 1.05, 0.06, 0.03, 2.4) for (z, cx, cy, a, t, b, n) in egg(1.0, 1.0, TOP, 0.0)], 24, 22, M['trim'])
can = smooth_loft('canopy', egg(1.0, 1.0, TOP), 28, 22, M['glass'], angle=80)
smooth_loft('canopy_tub', egg(0.95, 0.94, TOP - 0.01), 16, 14, M['carbon'])
for f in (-0.35, 0.35):
    z = CZ + f * CL; k = math.sqrt(max(0.0, 1 - f * f)) ** 0.8
    pts = [(CW * k * 1.01 * math.cos(t), TOP + CH * k * 1.01 * math.sin(t), z) for t in [i * math.pi / 12 for i in range(13)]]
    tube('canopy_bow', pts, 0.014, M['trim'])
tube('canopy_spine', [(0, TOP + CH * 0.62, CZ + CL * 0.8), (0, TOP + CH * 1.01, CZ), (0, TOP + CH * 0.62, CZ - CL * 0.8)], 0.014, M['trim'])
poly_loft('spine_strip', [(CZ - CL - 0.1, 0, _top(CZ - CL - 0.1) - 0.006, 0.1, 0.02, 0.02), (-1.6, 0, _top(-1.6) - 0.004, 0.3, 0.018, 0.018), (-2.6, 0, _top(-2.6) - 0.004, 0.36, 0.018, 0.018), (-3.4, 0, _top(-3.4) - 0.004, 0.22, 0.018, 0.018)], [(1, 0), (0.9, 1), (-0.9, 1), (-1, 0), (-0.9, -1), (0.9, -1)], 24, M['gun'], cap1=True, angle=80)
for sx in (1, -1):  # belly vents on the spine's underside
    for dz in (0.0, 0.3, 0.6):
        box('belly_vent', (0.36, 0.03, 0.12), (sx * 0.42, 0.62, 2.6 - dz), material=M['gun'])
# Twin raked dorsal fins at the spine's tail, with root fillets.
for side in (1, -1):
    df = plate('dorsal', [(0.25, 0.0), (-0.5, 0.9), (-0.85, 0.92), (-1.0, 0.0)], 0.17, M['paint'], 'x', 0.0, 0.05)
    place(df, (0, 0, -0.24 * side), (0.45 * side, 1.36, -3.0))
    dt = plate('dorsal_tip', [(-0.42, 0.83), (-0.46, 0.92), (-0.79, 0.93), (-0.76, 0.84)], 0.13, M['trim'], 'x', 0.0, 0.03)
    place(dt, (0, 0, -0.24 * side), (0.45 * side, 1.36, -3.0))
    subsurf(ring_loft('dorsal_root', [(-2.9, 0.45 * side, 1.4, 0.02, 0.02, 0.02, 2), (-3.1, 0.45 * side, 1.4, 0.13, 0.18, 0.04, 2.2), (-3.7, 0.45 * side, 1.4, 0.12, 0.16, 0.04, 2.2), (-4.0, 0.45 * side, 1.4, 0.02, 0.02, 0.02, 2)], around=12, material=M['paint']), 1)
# Pod thruster.
smooth(lathe('pod_nozzle', [(-3.95, 0.24), (-4.12, 0.26), (-4.2, 0.24)], 0, 0.84, 24, M['metal']), 40)
cyl('pod_hot', 0.16, 0.02, (0, 0.84, -3.98), 'z', 20, M['hot'])
smooth(lathe('pod_liner', [(-4.2, 0.23), (-4.08, 0.2), (-3.97, 0.17)], 0, 0.84, 24, M['carbon']), 50)
# Binder: a glowing arc across the intakes.

# Game hooks: nozzle exits, wingtip light, number plate.
for i, x in enumerate((-EX, 0.0, EX)):
    empty(f'nozzle_{i}' + ('' if x else '@0.45'), (x, EY if x else 0.84, NZ))
empty('wingtip', (EX + 0.8 + 1.9 * math.sin(0.55), 1.0, -0.4 - 1.9 * math.cos(0.55)))
empty('number', (EX + 0.77, EY + 0.05, 4.35))

out = os.environ.get('OUT', '/tmp')
print('TRIANGLES', tri_count()); tri_report()
export_glb(out + '/arrow.glb')
if not os.environ.get('NORENDER'): render_views(out + '/arrow')
finish()
