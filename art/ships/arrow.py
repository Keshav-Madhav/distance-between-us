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
    'glass': ((0.06, 0.08, 0.11), 0.3, 0.08), 'gun': ((0.23, 0.25, 0.28), 0.8, 0.34)}.items()}
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
right.append(fan('fan', EX, EY, 5.5, 0.17, 0.57, 26, 0.6, 0.15, M['metal']))
right.append(cyl('hub', 0.18, 0.06, (EX, EY, 5.42), 'z', 24, M['carbon']))
for i in range(12):  # stator vanes behind the fan
    a = 2 * math.pi * i / 12
    right.append(box('stator', (0.38, 0.02, 0.06), (EX + 0.37 * math.cos(a), EY + 0.37 * math.sin(a), 5.3), (0, 0, a), M['gun']))
right.append(cyl('spinner', 0.18, 0.4, (EX, EY, 5.65), 'z', 20, M['metal'], r2=0.02))

# ── Exposed machinery behind the can: compressor stages of different diameters (grey housings and
# dark gaps), canisters strapped along the core, two thick orange feed pipes clamped close to it.
for k, (z0, z1, r, m) in enumerate([(0.7, 0.32, 0.7, 'gun'), (0.32, -0.12, 0.6, 'carbon'), (-0.12, -0.72, 0.72, 'gun'),
                       (-0.72, -1.08, 0.58, 'carbon'), (-1.08, -1.85, 0.7, 'gun'), (-1.85, -2.6, 0.56, 'carbon')]):
    right.append(smooth(lathe('stage', [(z0, r * 0.94), (z0 - 0.03, r), (z1 + 0.03, r), (z1, r * 0.94)], EX, EY, 32, M[m], cap0=True, cap1=True), 40))
    if m == 'gun':  # flange lips at both ends, and radial ribs on two stages
        for z in (z0 - 0.02, z1 + 0.02):
            right.append(ring('flange', r + 0.01, 0.025, (EX, EY, z), 32, M['metal']))
        if k in (2, 4):
            for i in range(12):
                a = 2 * math.pi * (i + 0.5) / 12
                right.append(box('rib', (0.05, 0.05, abs(z1 - z0) - 0.1), (EX + (r + 0.02) * math.cos(a), EY + (r + 0.02) * math.sin(a), (z0 + z1) / 2), (0, 0, a - math.pi / 2), M['metal']))
for (a, z0, z1) in [(0.35, 0.55, -1.9), (2.75, 0.45, -1.7), (4.45, 0.5, -1.2)]:
    x, y = EX + 0.76 * math.cos(a), EY + 0.76 * math.sin(a)
    right.append(cyl('canister', 0.15, z0 - z1, (x, y, (z0 + z1) / 2), 'z', 12, M['metal']))
    for z in (z0 - 0.15, z1 + 0.15):
        right.append(cyl('canister_cap', 0.16, 0.1, (x, y, z), 'z', 12, M['trim']))
for a in (1.55, 5.35):
    pts = [(EX + 0.66 * math.cos(a), EY + 0.66 * math.sin(a), z) for z in (0.75, 0.2, -0.4, -1.0, -1.6, -2.4)]
    pts = [(EX + 0.8 * math.cos(a), EY + 0.8 * math.sin(a), 0.75)] + [(EX + (0.77 if i % 2 else 0.64) * math.cos(a), EY + (0.77 if i % 2 else 0.64) * math.sin(a), z) for i, z in enumerate((0.45, 0.0, -0.45, -0.95, -1.5, -2.1, -2.5))]
    right.append(tube('feed_pipe', [(EX + rr * math.cos(a), EY + rr * math.sin(a), z) for (z, rr) in [(0.72, 0.74), (0.5, 0.75), (-0.1, 0.78), (-0.8, 0.76), (-1.4, 0.78), (-2.2, 0.72), (-2.5, 0.62)]], 0.06, M['trim']))
    for z in (0.5, -0.1, -0.8, -1.4, -2.0):
        right.append(cyl('collar', 0.08, 0.06, (EX + 0.77 * math.cos(a), EY + 0.77 * math.sin(a), z), 'z', 12, M['gun']))

# ── Nozzle: a flared metal can with a crown of petals ending on the exit plane; the hot core inside.
right.append(smooth(lathe('nozzle', [(-2.6, 0.5), (-2.9, 0.57), (-3.5, 0.55), (-3.75, 0.5)], EX, EY, 40, M['metal']), 30))
right.append(ring('nozzle_band', 0.565, 0.03, (EX, EY, -3.1), 40, M['trim']))
right.append(ring('crown_base', 0.5, 0.07, (EX, EY, -3.72), 40, M['gun']))
right.append(petals('petals', EX, EY, -3.72, 0.5, 12, 0.42, 0.12, 0.14, 0.02, M['metal']))
right.append(smooth(lathe('liner', [(-3.5, 0.48), (-3.7, 0.44), (-3.8, 0.0)], EX, EY, 32, M['carbon']), 60))
c = bpy.data.objects.get('liner')
right.append(cyl('hot_core', 0.4, 0.02, (EX, EY, -3.72), 'z', 32, M['hot']))

# ── Side vane (outboard of each engine) sweeping out into a fin at the back.
fin = plate('fin', [(0.0, 0.62), (0.0, 1.02), (-1.25, 1.22), (-1.7, 0.82), (-1.4, 0.6)], 0.06, M['paint'], 'x', 0.0)
place(fin, (0, -0.6, 0), (EX + 0.7, 0.0, 1.5)); right.append(fin)
ft = plate('fin_tip', [(-1.12, 1.17), (-1.3, 1.21), (-1.78, 0.75), (-1.62, 0.72)], 0.07, M['trim'], 'x', 0.0, 0.01)
place(ft, (0, -0.6, 0), (EX + 0.7, 0.0, 1.5)); right.append(ft)
# ── Skid rail along each can's lower outer side, faired into it; the hover glow under it.
right.append(box('skid_rail', (0.07, 0.07, 3.3), (EX + 0.66, EY - 0.5, 3.4), material=M['metal'], bevel=0.015))
for z in (4.8, 3.4, 2.0):
    right.append(box('standoff', (0.08, 0.1, 0.1), (EX + 0.6, EY - 0.45, z), (0, 0, 0.75), M['gun']))
right.append(box('skid_glow', (0.05, 0.01, 3.1), (EX + 0.66, EY - 0.54, 3.4), material=M['glow']))
# Rear fin root: a fairing and an actuator housing where the swept fin meets the engine.
right.append(subsurf_obj(ring_loft('fin_root', [(1.75, EX + 0.68, EY + 0.12, 0.02, 0.02, 0.02, 2), (1.5, EX + 0.68, EY + 0.12, 0.1, 0.16, 0.12, 2.2), (0.95, EX + 0.68, EY + 0.12, 0.09, 0.14, 0.1, 2.2), (0.6, EX + 0.68, EY + 0.12, 0.02, 0.02, 0.02, 2)], around=12, material=M['paint']), 1))
right.append(cyl('fin_act', 0.05, 0.55, (EX + 0.8, EY + 0.32, 0.9), 'z', 10, M['gun']))

# ── Struts: a swept beam at the front, an X brace behind it.
right.append(tube('brace', [(0.6, 0.9, 0.5), (EX - 0.66, EY + 0.1, -1.1)], 0.055, M['carbon']))
right.append(tube('brace', [(0.6, 0.9, -1.2), (EX - 0.66, EY + 0.1, 0.4)], 0.055, M['carbon']))

join_mirror(right)

# ── Centre spine: wide, flat-topped with chamfered sides, its top up on the engines' top line.
body = ring_loft('body', [
    (6.15, 0, 0.8, 0.1, 0.04, 0.04, 2.0),
    (5.5, 0, 0.82, 0.42, 0.24, 0.22, 3.6),
    (3.8, 0, 0.88, 0.5, 0.5, 0.3, 4.2),
    (1.2, 0, 0.92, 0.6, 0.6, 0.32, 4.4),
    (-1.0, 0, 0.92, 0.72, 0.6, 0.32, 4.4),
    (-2.8, 0, 0.9, 0.8, 0.56, 0.3, 4.4),
    (-3.7, 0, 0.86, 0.74, 0.46, 0.3, 3.8),
    (-4.1, 0, 0.84, 0.52, 0.3, 0.26, 3.0),
], around=24, cap0=False, cap1=True, material=M['paint'])
subsurf(body)
# Canopy: forward on the spine, smoked, set in a flush orange frame.
TOP = 1.5
frame = ring_loft('canopy_frame', [(2.0, 0, TOP - 0.06, 0.06, 0.06, 0.04, 2.0), (1.7, 0, TOP - 0.06, 0.34, 0.08, 0.04, 2.4), (0.7, 0, TOP - 0.06, 0.45, 0.09, 0.04, 2.4), (-0.3, 0, TOP - 0.06, 0.38, 0.08, 0.04, 2.4), (-0.6, 0, TOP - 0.06, 0.06, 0.06, 0.04, 2.0)], around=24, material=M['trim'])
subsurf(frame, 1)
can = ring_loft('canopy', [(1.9, 0, TOP, 0.05, 0.02, 0.02, 2.0), (1.6, 0, TOP, 0.3, 0.12, 0.03, 2.4), (0.7, 0, TOP, 0.41, 0.24, 0.04, 2.4), (-0.2, 0, TOP, 0.33, 0.16, 0.03, 2.4), (-0.5, 0, TOP, 0.05, 0.02, 0.02, 2.0)], around=24, material=M['glass'])
subsurf(can, 1)
# Twin raked dorsal fins at the spine's tail, with root fillets.
for side in (1, -1):
    df = plate('dorsal', [(0.0, 0.0), (-0.32, 0.66), (-0.62, 0.66), (-0.68, 0.0)], 0.06, M['paint'], 'x', 0.0)
    place(df, (0, 0, -0.14 * side), (0.36 * side, 1.4, -2.85))
    dt = plate('dorsal_tip', [(-0.3, 0.6), (-0.33, 0.67), (-0.63, 0.67), (-0.6, 0.6)], 0.07, M['trim'], 'x', 0.0, 0.01)
    place(dt, (0, 0, -0.14 * side), (0.36 * side, 1.4, -2.85))
    subsurf(ring_loft('dorsal_root', [(-2.75, 0.36 * side, 1.42, 0.02, 0.02, 0.02, 2), (-2.95, 0.36 * side, 1.42, 0.08, 0.1, 0.04, 2.2), (-3.4, 0.36 * side, 1.42, 0.07, 0.08, 0.04, 2.2), (-3.6, 0.36 * side, 1.42, 0.02, 0.02, 0.02, 2)], around=12, material=M['paint']), 1)
# Pod thruster.
smooth(lathe('pod_nozzle', [(-3.95, 0.24), (-4.12, 0.26), (-4.2, 0.24)], 0, 0.84, 24, M['metal']), 40)
cyl('pod_hot', 0.19, 0.02, (0, 0.84, -4.0), 'z', 20, M['hot'])
# Binder: a glowing arc across the intakes.
tube('binder', [(-EX + 0.62, EY, 6.0), (-0.5, EY, 6.12), (0, EY, 6.15), (0.5, EY, 6.12), (EX - 0.62, EY, 6.0)], 0.05, M['glow'])

# Game hooks: nozzle exits, wingtip light, number plate.
for i, x in enumerate((-EX, 0.0, EX)):
    empty(f'nozzle_{i}' + ('' if x else '@0.45'), (x, EY if x else 0.84, NZ))
empty('wingtip', (EX + 0.8 + 1.9 * math.sin(0.55), 1.0, -0.4 - 1.9 * math.cos(0.55)))
empty('number', (EX + 0.77, EY + 0.05, 3.3))

out = os.environ.get('OUT', '/tmp')
print('TRIANGLES', tri_count()); tri_report()
export_glb(out + '/arrow.glb')
if not os.environ.get('NORENDER'): render_views(out + '/arrow')
finish()
