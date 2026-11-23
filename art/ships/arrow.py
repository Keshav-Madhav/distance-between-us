# ARROW — from concept art/ships/concepts/arrow-0.png. Twin white engine cans with fan intakes and an
# orange band; behind each can the turbine machinery is exposed (rings, ribs, pipes, actuators) down
# to a spiked nozzle. A narrow nose body runs between the intakes back to a pod with a long dark
# canopy on a wide flat spine; X-braced struts tie it to the engines; swept fins at the back; a
# glowing binder spans the intakes; hover skids underneath. Game frame: x right, y up, z forward.
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from lib import *

reset()
M = {k: mat(k, *v) for k, v in {
    'paint': ((0.86, 0.87, 0.88), 0.1, 0.35), 'trim': ((0.95, 0.42, 0.1), 0.2, 0.4),
    'carbon': ((0.16, 0.17, 0.19), 0.4, 0.5), 'metal': ((0.62, 0.64, 0.68), 1.0, 0.3),
    'glass': ((0.06, 0.08, 0.11), 0.3, 0.08)}.items()}
M['glow'] = mat('glow', (0.4, 0.85, 1.0), 0, 0.3, emit=(0.4, 0.85, 1.0))
M['hot'] = mat('hot', (1.0, 0.55, 0.2), 0, 0.3, emit=(1.0, 0.55, 0.2))

EX, EY, NZ = 1.55, 0.78, -4.2
right = []  # right-side parts, mirrored at the end

# ── Engine can: one lathe profile, split by material along its length so the orange band is part of
# the same skin (same rings, no step).
lip = [(6.0, 0.6), (6.04, 0.66), (6.0, 0.72), (5.85, 0.745)]
right.append(smooth(lathe('can_lip', lip + [(5.6, 0.75)], EX, EY, 40, M['paint']), 30))
right.append(smooth(lathe('can_band0', [(5.6, 0.75), (5.15, 0.75)], EX, EY, 40, M['trim']), 30))
right.append(smooth(lathe('can_front', [(5.15, 0.75), (4.6, 0.75), (1.65, 0.74)], EX, EY, 40, M['paint']), 30))
# Paired vent slots near the rear band (skin detail, sparse).
for a in (1.05, 1.25):
    right.append(box('vent_slot', (0.05, 0.03, 0.4), (EX + 0.742 * math.cos(a), EY + 0.742 * math.sin(a), 2.3), (0, 0, a - math.pi / 2), M['carbon']))

right.append(smooth(lathe('can_band', [(1.65, 0.74), (1.05, 0.735)], EX, EY, 40, M['trim']), 30))
right.append(smooth(lathe('can_rear', [(1.05, 0.735), (0.75, 0.73), (0.7, 0.69)], EX, EY, 40, M['paint']), 30))
right.append(ring('can_rim', 0.7, 0.03, (EX, EY, 0.7), 40, M['metal']))
# Intake: a dark duct, a fan of blades, a spinner.
right.append(smooth(lathe('duct', [(6.0, 0.6), (5.7, 0.59), (5.4, 0.58)], EX, EY, 32, M['carbon'], cap1=True), 60))
for i in range(16):
    a = 2 * math.pi * i / 16
    right.append(box('blade', (0.42, 0.02, 0.08), (EX + 0.34 * math.cos(a), EY + 0.34 * math.sin(a), 5.5), (0, 0, a), M['metal']))
right.append(cyl('spinner', 0.18, 0.4, (EX, EY, 5.65), 'z', 20, M['metal'], r2=0.02))

# ── Exposed machinery behind the can: compressor stages of different diameters (grey housings and
# dark gaps), canisters strapped along the core, two thick orange feed pipes clamped close to it.
for (z0, z1, r, m) in [(0.7, 0.32, 0.7, 'metal'), (0.32, -0.12, 0.6, 'carbon'), (-0.12, -0.72, 0.72, 'carbon'),
                       (-0.72, -1.08, 0.58, 'carbon'), (-1.08, -1.85, 0.7, 'carbon'), (-1.85, -2.6, 0.56, 'carbon')]:
    right.append(smooth(lathe('stage', [(z0, r * 0.94), (z0 - 0.03, r), (z1 + 0.03, r), (z1, r * 0.94)], EX, EY, 32, M[m], cap0=True, cap1=True), 40))
for (a, z0, z1) in [(0.35, 0.55, -1.9), (2.75, 0.45, -1.7), (4.45, 0.5, -1.2)]:
    x, y = EX + 0.76 * math.cos(a), EY + 0.76 * math.sin(a)
    right.append(cyl('canister', 0.15, z0 - z1, (x, y, (z0 + z1) / 2), 'z', 12, M['metal']))
    for z in (z0 - 0.15, z1 + 0.15):
        right.append(cyl('canister_cap', 0.16, 0.1, (x, y, z), 'z', 12, M['trim']))
for a in (1.55, 5.35):
    pts = [(EX + 0.66 * math.cos(a), EY + 0.66 * math.sin(a), z) for z in (0.75, 0.2, -0.4, -1.0, -1.6, -2.4)]
    right.append(tube('feed_pipe', pts, 0.045, M['trim']))
    for z in (0.45, -0.4, -1.3, -2.1):
        right.append(box('clamp', (0.14, 0.05, 0.08), (EX + 0.67 * math.cos(a), EY + 0.67 * math.sin(a), z), (0, 0, a - math.pi / 2), M['carbon']))

# ── Nozzle: a flared metal can with a crown of petals ending on the exit plane; the hot core inside.
right.append(smooth(lathe('nozzle', [(-2.6, 0.5), (-2.9, 0.57), (-3.5, 0.55), (-3.75, 0.5)], EX, EY, 40, M['metal']), 30))
right.append(ring('nozzle_band', 0.565, 0.03, (EX, EY, -3.1), 40, M['trim']))
right.append(ring('crown_base', 0.5, 0.06, (EX, EY, -3.74), 40, M['metal']))
for i in range(14):
    a = 2 * math.pi * i / 14
    p = cyl('petal', 0.07, 0.5, (EX + 0.48 * math.cos(a), EY + 0.48 * math.sin(a), -3.94), 'z', 4, M['metal'], r2=0.015)
    right.append(p)
right.append(smooth(lathe('liner', [(-3.5, 0.48), (-3.7, 0.44), (-3.8, 0.0)], EX, EY, 32, M['carbon']), 60))
c = bpy.data.objects.get('liner')
right.append(cyl('hot_core', 0.4, 0.02, (EX, EY, -3.72), 'z', 32, M['hot']))

# ── Side vane (outboard of each engine) sweeping out into a fin at the back.
fin = plate('fin', [(0.0, 0.45), (0.0, 1.05), (-1.3, 1.2), (-1.75, 0.75), (-1.5, 0.45)], 0.06, M['paint'], 'x', 0.0)
place(fin, (0, -0.55, 0), (EX + 0.8, 0.0, -0.4)); right.append(fin)
ft = plate('fin_tip', [(-1.12, 1.17), (-1.3, 1.21), (-1.78, 0.75), (-1.62, 0.72)], 0.07, M['trim'], 'x', 0.0, 0.01)
place(ft, (0, -0.55, 0), (EX + 0.8, 0.0, -0.4)); right.append(ft)
# ── Skid rail along each can's lower outer side, faired into it; the hover glow under it.
rail = ring_loft('skid_rail', [(5.2, EX + 0.62, EY - 0.42, 0.02, 0.02, 0.02, 2), (4.7, EX + 0.62, EY - 0.42, 0.1, 0.08, 0.06, 2.6),
    (0.4, EX + 0.62, EY - 0.42, 0.1, 0.08, 0.06, 2.6), (-0.1, EX + 0.62, EY - 0.42, 0.02, 0.02, 0.02, 2)], around=12, material=M['carbon'])
subsurf(rail); right.append(rail)
right.append(box('skid_glow', (0.06, 0.01, 4.3), (EX + 0.62, EY - 0.49, 2.4), material=M['glow']))
# Rear fin root: a fairing and an actuator housing where the swept fin meets the engine.
right.append(cyl('fin_root', 0.11, 0.9, (EX + 0.78, EY + 0.1, -0.9), 'z', 12, M['metal']))
right.append(cyl('fin_act', 0.06, 0.5, (EX + 0.86, EY + 0.28, -1.0), 'z', 10, M['carbon']))

# ── Struts: a swept beam at the front, an X brace behind it.
right.append(tube('brace', [(0.6, 0.9, 0.5), (EX - 0.66, EY + 0.1, -1.1)], 0.055, M['carbon']))
right.append(tube('brace', [(0.6, 0.9, -1.2), (EX - 0.66, EY + 0.1, 0.4)], 0.055, M['carbon']))

join_mirror(right)

# ── Centre spine: wide, flat-topped with chamfered sides, its top up on the engines' top line.
body = ring_loft('body', [
    (6.15, 0, 0.8, 0.08, 0.04, 0.04, 2.0),
    (5.5, 0, 0.82, 0.4, 0.26, 0.22, 3.2),
    (3.8, 0, 0.88, 0.56, 0.5, 0.3, 3.6),
    (1.2, 0, 0.92, 0.62, 0.6, 0.32, 3.8),
    (-1.6, 0, 0.92, 0.62, 0.6, 0.32, 3.8),
    (-3.4, 0, 0.88, 0.5, 0.48, 0.3, 3.4),
    (-4.05, 0, 0.84, 0.36, 0.34, 0.28, 2.6),
], around=24, cap0=False, cap1=True, material=M['paint'])
subsurf(body)
# Canopy: a long smoked oval sunk into the spine's flat top, framed in orange.
can = ring_loft('canopy', [
    (0.6, 0, 1.47, 0.05, 0.02, 0.02, 2.0),
    (0.1, 0, 1.47, 0.3, 0.12, 0.06, 2.4),
    (-1.0, 0, 1.47, 0.42, 0.2, 0.08, 2.4),
    (-2.1, 0, 1.47, 0.34, 0.14, 0.06, 2.4),
    (-2.7, 0, 1.47, 0.05, 0.02, 0.02, 2.0),
], around=24, material=M['glass'])
subsurf(can)
for z in (-0.1, -1.0, -1.9):
    k = math.sqrt(max(0.0, 1 - ((z + 1.0) / 1.7) ** 2))
    pts = [(0.43 * k * math.cos(t), 1.47 + 0.21 * k * math.sin(t), z) for t in [i * math.pi / 12 for i in range(13)]]
    tube('canopy_bow', pts, 0.018, M['trim'])
tube('canopy_spine', [(0, 1.58, 0.2), (0, 1.69, -1.0), (0, 1.62, -2.2)], 0.018, M['trim'])
# Twin raked dorsal fins at the spine's tail.
df = plate('dorsal', [(0.0, 0.0), (-0.3, 0.55), (-0.75, 0.6), (-0.9, 0.0)], 0.05, M['paint'], 'x', 0.0)
place(df, (0, 0, -0.12), (0.32, 1.36, -2.9)); mirror_x(df)
dt = plate('dorsal_tip', [(-0.28, 0.5), (-0.32, 0.56), (-0.76, 0.61), (-0.72, 0.54)], 0.06, M['trim'], 'x', 0.0, 0.01)
place(dt, (0, 0, -0.12), (0.32, 1.36, -2.9)); mirror_x(dt)
# Pod thruster.
smooth(lathe('pod_nozzle', [(-3.95, 0.24), (-4.12, 0.26), (-4.2, 0.24)], 0, 0.84, 24, M['metal']), 40)
cyl('pod_hot', 0.19, 0.02, (0, 0.84, -4.0), 'z', 20, M['hot'])
# Binder: a glowing arc across the intakes.
tube('binder', [(-EX + 0.62, EY, 6.0), (-0.5, EY, 6.12), (0, EY, 6.15), (0.5, EY, 6.12), (EX - 0.62, EY, 6.0)], 0.05, M['glow'])

# Game hooks: nozzle exits, wingtip light, number plate.
for i, x in enumerate((-EX, 0.0, EX)):
    empty(f'nozzle_{i}', (x, EY if x else 0.84, NZ))
empty('wingtip', (EX + 0.8 + 1.9 * math.sin(0.55), 1.0, -0.4 - 1.9 * math.cos(0.55)))
empty('number', (EX + 0.77, EY + 0.05, 3.3))

out = os.environ.get('OUT', '/tmp')
print('TRIANGLES', tri_count())
export_glb(out + '/arrow.glb')
render_views(out + '/arrow')
finish()
