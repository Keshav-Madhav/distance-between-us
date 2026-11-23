# ARROW — from concept art/ships/concepts/arrow-0.png. Twin white engine cans with fan intakes and an
# orange band; behind each can the turbine machinery is exposed (rings, ribs, pipes, actuators) down
# to a spiked nozzle. A narrow nose body runs between the intakes back to a pod with a long dark
# canopy; X-braced struts tie pod to engines; grey side vanes sweep out into fins at the back; a
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
right.append(smooth(lathe('can_front', lip + [(4.6, 0.75), (1.65, 0.74)], EX, EY, 40, M['paint']), 30))
right.append(smooth(lathe('can_band', [(1.65, 0.74), (1.05, 0.735)], EX, EY, 40, M['trim']), 30))
right.append(smooth(lathe('can_rear', [(1.05, 0.735), (0.75, 0.73), (0.7, 0.69)], EX, EY, 40, M['paint']), 30))
right.append(ring('can_rim', 0.7, 0.03, (EX, EY, 0.7), 40, M['metal']))
# Intake: a dark duct, a fan of blades, a spinner.
right.append(smooth(lathe('duct', [(6.0, 0.6), (5.7, 0.59), (5.4, 0.58)], EX, EY, 32, M['carbon'], cap1=True), 60))
for i in range(16):
    a = 2 * math.pi * i / 16
    right.append(box('blade', (0.42, 0.02, 0.08), (EX + 0.34 * math.cos(a), EY + 0.34 * math.sin(a), 5.5), (0, 0, a), M['metal']))
right.append(cyl('spinner', 0.18, 0.4, (EX, EY, 5.65), 'z', 20, M['metal'], r2=0.02))

# ── Exposed machinery behind the can.
right.append(smooth(lathe('core', [(0.75, 0.5), (0.3, 0.52), (-0.3, 0.48), (-0.9, 0.55), (-1.6, 0.56), (-2.1, 0.5), (-2.6, 0.48)], EX, EY, 32, M['carbon']), 40))
for z in (0.35, -0.55, -1.25, -1.95):
    right.append(ring('turbine_ring', 0.56 if z < -0.5 else 0.53, 0.035, (EX, EY, z), 32, M['metal']))
for i in range(10):  # radial ribs
    a = 2 * math.pi * (i + 0.5) / 10
    right.append(box('rib', (0.06, 0.05, 2.9), (EX + 0.56 * math.cos(a), EY + 0.56 * math.sin(a), -0.95), (0, 0, a), M['carbon']))
for i, (a0, col, r) in enumerate([(0.6, 'trim', 0.05), (1.4, 'metal', 0.035), (2.6, 'trim', 0.045), (3.6, 'metal', 0.04), (4.6, 'trim', 0.04), (5.5, 'metal', 0.035)]):
    pts = []
    for k in range(7):
        z = 0.65 - k * 0.5
        rr = 0.66 - 0.06 * math.sin(k * 0.9)
        a = a0 + 0.08 * math.sin(k * 1.3 + i)
        pts.append((EX + rr * math.cos(a), EY + rr * math.sin(a), z))
    right.append(tube('pipe', pts, r, M[col]))
for (a, z) in [(0.2, -0.2), (2.2, -1.0), (4.0, -0.4), (5.0, -1.6)]:  # actuator cans with orange caps
    x, y = EX + 0.66 * math.cos(a), EY + 0.66 * math.sin(a)
    right.append(cyl('actuator', 0.08, 0.5, (x, y, z), 'z', 12, M['metal']))
    right.append(cyl('actuator_cap', 0.085, 0.1, (x, y, z + 0.27), 'z', 12, M['trim']))

# ── Nozzle: a flared metal can with a crown of petals ending on the exit plane; the hot core inside.
right.append(smooth(lathe('nozzle', [(-2.6, 0.5), (-2.9, 0.57), (-3.5, 0.55), (-3.75, 0.5)], EX, EY, 40, M['metal']), 30))
right.append(ring('nozzle_band', 0.565, 0.03, (EX, EY, -3.1), 40, M['trim']))
for i in range(14):
    a = 2 * math.pi * i / 14
    p = cyl('petal', 0.06, 0.55, (EX + 0.47 * math.cos(a), EY + 0.47 * math.sin(a), -3.95), 'z', 4, M['metal'], r2=0.012)
    right.append(p)
right.append(smooth(lathe('liner', [(-3.5, 0.48), (-3.7, 0.44), (-3.8, 0.0)], EX, EY, 32, M['carbon']), 60))
c = bpy.data.objects.get('liner')
right.append(cyl('hot_core', 0.4, 0.02, (EX, EY, -3.72), 'z', 32, M['hot']))

# ── Side vane (outboard of each engine) sweeping out into a fin at the back.
v = plate('vane', [(4.0, 0.45), (3.6, 1.3), (0.8, 1.34), (-0.3, 1.0), (-0.3, 0.4), (3.4, 0.3)], 0.06, M['paint'], 'x', EX + 0.8)
right.append(v)
right.append(plate('vane_trim', [(3.62, 1.26), (3.55, 1.34), (0.8, 1.38), (0.86, 1.3)], 0.07, M['trim'], 'x', EX + 0.8, 0.01))
right.append(plate('vane_edge', [(4.0, 0.45), (3.4, 0.3), (-0.3, 0.4), (-0.3, 0.5), (3.4, 0.4)], 0.07, M['carbon'], 'x', EX + 0.8, 0.01))
fin = plate('fin', [(0.0, 0.45), (0.0, 1.05), (-1.3, 1.2), (-1.75, 0.75), (-1.5, 0.45)], 0.06, M['paint'], 'x', 0.0)
place(fin, (0, -0.55, 0), (EX + 0.8, 0.0, -0.4)); right.append(fin)
ft = plate('fin_tip', [(-1.12, 1.17), (-1.3, 1.21), (-1.78, 0.75), (-1.62, 0.72)], 0.07, M['trim'], 'x', 0.0, 0.01)
place(ft, (0, -0.55, 0), (EX + 0.8, 0.0, -0.4)); right.append(ft)
for z in (3.4, 2.0, 0.6):  # brackets tying the vane to the can
    right.append(box('vane_bracket', (0.12, 0.12, 0.3), (EX + 0.73, EY, z), material=M['metal']))

# ── Hover skid under each engine.
right.append(plate('skid', [(3.8, 0.0), (3.6, 0.06), (-1.6, 0.06), (-1.9, 0.0)], 0.32, M['carbon'], 'x', EX, 0.015))
right.append(box('skid_glow', (0.18, 0.012, 5.2), (EX, -0.01, 1.0), material=M['glow']))
for z in (2.8, -0.9):
    right.append(box('skid_strut', (0.1, 0.18, 0.22), (EX, 0.1, z), material=M['metal']))

# ── Struts: a swept beam at the front, an X brace behind it.
right.append(plate('beam', [(2.1, -0.06), (1.6, 0.06), (0.9, 0.06), (1.2, -0.06)], 1.0, M['paint'], 'y', 0.0) if False else box('beam', (EX - 0.95, 0.09, 0.5), (0.48 + (EX - 0.95) / 2, EY - 0.02, 1.8), material=M['paint'], bevel=0.02))
right.append(tube('brace', [(0.55, 0.85, 0.5), (EX - 0.6, EY + 0.1, -1.1)], 0.055, M['carbon']))
right.append(tube('brace', [(0.55, 0.85, -1.2), (EX - 0.6, EY + 0.1, 0.4)], 0.055, M['carbon']))

join_mirror(right)

# ── Centre body: a narrow nose between the intakes rising into the pod (one surface).
body = ring_loft('body', [
    (6.15, 0, 0.72, 0.05, 0.03, 0.03, 2.0),
    (5.4, 0, 0.74, 0.30, 0.16, 0.18, 2.6),
    (3.8, 0, 0.76, 0.42, 0.24, 0.26, 2.8),
    (1.8, 0, 0.78, 0.48, 0.32, 0.30, 2.8),
    (0.2, 0, 0.82, 0.62, 0.46, 0.34, 2.6),
    (-1.8, 0, 0.84, 0.64, 0.5, 0.34, 2.6),
    (-3.4, 0, 0.8, 0.5, 0.42, 0.32, 2.4),
    (-4.0, 0, 0.8, 0.36, 0.32, 0.3, 2.2),
], around=20, cap0=False, cap1=True, material=M['paint'])
subsurf(body)
# Orange spine stripe: a thin strip on the nose's top (part of the livery, laid on the skin).
stripe = ring_loft('stripe', [(5.6, 0, 0.92, 0.07, 0.02, 0.0, 2), (3.0, 0, 1.03, 0.08, 0.02, 0.0, 2), (1.6, 0, 1.1, 0.06, 0.02, 0.0, 2)], around=8, material=M['trim'])
subsurf(stripe, 1)
# Canopy: long and dark, sunk into the pod top, framed in orange.
can = ring_loft('canopy', [
    (1.1, 0, 1.12, 0.06, 0.02, 0.02, 2.0),
    (0.5, 0, 1.14, 0.34, 0.2, 0.1, 2.3),
    (-0.8, 0, 1.18, 0.42, 0.3, 0.12, 2.3),
    (-2.2, 0, 1.16, 0.36, 0.24, 0.1, 2.3),
    (-2.9, 0, 1.12, 0.05, 0.02, 0.02, 2.0),
], around=20, material=M['glass'])
subsurf(can)
for z in (0.2, -1.4):
    k = 1 - abs(z + 0.8) / 2.2
    pts = [(0.42 * k * math.cos(t), 1.18 + 0.3 * k * math.sin(t), z) for t in [i * math.pi / 10 for i in range(11)]]
    tube('canopy_bow', pts, 0.02, M['trim'])
tube('canopy_spine', [(0, 1.3, 0.5), (0, 1.47, -0.8), (0, 1.41, -2.2)], 0.018, M['trim'])
# Pod thruster.
smooth(lathe('pod_nozzle', [(-3.95, 0.34), (-4.1, 0.36), (-4.2, 0.33)], 0, 0.8, 32, M['metal']), 40)
cyl('pod_hot', 0.27, 0.02, (0, 0.8, -4.05), 'z', 24, M['hot'])
# Binder: a glowing arc across the intakes.
tube('binder', [(-EX + 0.62, EY, 6.0), (-0.5, EY, 6.12), (0, EY, 6.15), (0.5, EY, 6.12), (EX - 0.62, EY, 6.0)], 0.03, M['glow'])

# Game hooks: nozzle exits, wingtip light, number plate.
for i, x in enumerate((-EX, 0.0, EX)):
    empty(f'nozzle_{i}', (x, EY if x else 0.8, NZ))
empty('wingtip', (EX + 0.8 + 1.9 * math.sin(0.55), 1.0, -0.4 - 1.9 * math.cos(0.55)))
empty('number', (EX + 0.84, 0.85, 2.2))

out = os.environ.get('OUT', '/tmp')
print('TRIANGLES', tri_count())
export_glb(out + '/arrow.glb')
render_views(out + '/arrow')
finish()
