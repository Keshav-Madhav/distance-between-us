# Ship modelling helpers for Blender (headless). Coordinates are the GAME's: x right, y up, z forward
# (the nose points +z). G() converts to Blender's z-up frame; the glTF exporter converts back.
import bpy, bmesh, math
from mathutils import Vector

def G(x, y, z):
    return Vector((x, -z, y))

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, rgb=(0.7, 0.7, 0.7), metal=0.0, rough=0.4, emit=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    m.diffuse_color = (*rgb, 1); m.metallic = metal; m.roughness = rough  # (Workbench previews use these)
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = 3.0
    return m

def obj_from_bm(name, bm, material=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if material:
        ob.data.materials.append(material)
    return ob

def ring_loft(name, rings, around=16, cap0=True, cap1=True, material=None, crease_ends=False):
    """rings: list of (z, cx, cy, rx, ry_top, ry_bot, n) — superellipse sections along z (game frame).
    Builds a quad cage meant for a Subdivision modifier."""
    bm = bmesh.new()
    loops = []
    for (z, cx, cy, rx, ryt, ryb, n) in rings:
        e = 2.0 / n
        ring = []
        for j in range(around):
            th = 2 * math.pi * j / around
            c, s = math.cos(th), math.sin(th)
            x = rx * math.copysign(abs(c) ** e, c)
            y = (ryt if s >= 0 else ryb) * math.copysign(abs(s) ** e, s)
            ring.append(bm.verts.new(G(cx + x, cy + y, z)))
        loops.append(ring)
    for a, b in zip(loops, loops[1:]):
        for j in range(around):
            j1 = (j + 1) % around
            bm.faces.new((a[j], a[j1], b[j1], b[j]))
    if cap0: bm.faces.new(list(reversed(loops[0])))
    if cap1: bm.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(name, bm, material)

def subsurf(ob, levels=2):
    m = ob.modifiers.new('sub', 'SUBSURF'); m.levels = levels; m.render_levels = levels
    return m

def mirror_x(ob):
    m = ob.modifiers.new('mir', 'MIRROR'); m.use_axis = (True, False, False)
    return m

def box(name, size, at, rot=(0, 0, 0), material=None, bevel=0.0):
    """size/at in game frame (w, h, d) / (x, y, z); rot in game frame radians (rx, ry, rz)."""
    bpy.ops.mesh.primitive_cube_add(size=1)
    ob = bpy.context.active_object; ob.name = name
    ob.scale = (size[0], size[2], size[1])
    ob.location = G(*at)
    ob.rotation_euler = (rot[0], -rot[2], rot[1])  # game (rx, ry, rz) -> blender (rx, -rz, ry)
    # (All transforms applied: the origin stays at the world centre, so a Mirror modifier mirrors
    # across the ship's centre line, not the part's own.)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if bevel:
        bv = ob.modifiers.new('bev', 'BEVEL'); bv.width = bevel; bv.segments = 2
    if material: ob.data.materials.append(material)
    return ob

def render_views(out_prefix, views=None, res=(900, 560)):
    """Workbench renders from fixed game-frame camera positions (silhouette and form checks)."""
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'MATERIAL'
    sc.display.shading.show_cavity = True
    sc.display.shading.show_shadows = True
    sc.display.shading.show_object_outline = True
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    w = bpy.data.worlds.new('w'); sc.world = w; w.color = (0.62, 0.72, 0.82)
    views = views or {
        'side': ((24, 0.8, 0.8), (0, 0.6, 0.8)), 'top': ((0, 26, 0.81), (0, 0, 0.8)),
        'front': ((0, 0.9, 22), (0, 0.6, 0)), 'q34f': ((11, 5.0, 13), (0, 0.6, 0.6)),
        'q34r': ((-11, 5.0, -13), (0, 0.6, -0.4)), 'rear': ((0, 1.6, -20), (0, 0.6, 0)),
        'chase': ((0, 3.2, -15), (0, 1.0, 2)),
    }
    cam_data = bpy.data.cameras.new('cam'); cam_data.lens = 50
    cam = bpy.data.objects.new('cam', cam_data); bpy.context.collection.objects.link(cam); sc.camera = cam
    for k, (pos, tgt) in views.items():
        cam.location = G(*pos)
        d = G(*tgt) - G(*pos)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = f'{out_prefix}-{k}.png'
        bpy.ops.render.render(write_still=True)

def finish():
    bpy.ops.wm.quit_blender()

# ── more parts ──────────────────────────────────────────────────────────────────────────────────
def lathe(name, profile, cx=0.0, cy=0.0, seg=32, material=None, sx=1.0, sy=1.0, cap0=False, cap1=False):
    """A surface of revolution about the z axis (game frame) through (cx, cy): profile = [(z, r)] front→back."""
    bm = bmesh.new(); loops = []
    for (z, r) in profile:
        loops.append([bm.verts.new(G(cx + r * sx * math.cos(2 * math.pi * j / seg), cy + r * sy * math.sin(2 * math.pi * j / seg), z)) for j in range(seg)])
    for a, b in zip(loops, loops[1:]):
        for j in range(seg):
            j1 = (j + 1) % seg
            try: bm.faces.new((a[j], b[j], b[j1], a[j1]))
            except ValueError: pass
    if cap0: bm.faces.new(loops[0])
    if cap1: bm.faces.new(list(reversed(loops[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(name, bm, material)

def smooth(ob, angle=40):
    """Smooth shading with hard edges above `angle` degrees (curved skin smooth, real edges crisp)."""
    for p in ob.data.polygons: p.use_smooth = True
    m = ob.modifiers.new('smooth', 'EDGE_SPLIT'); m.split_angle = math.radians(angle); m.use_edge_sharp = True
    return ob

def cyl(name, r, length, at, axis='z', seg=16, material=None, r2=None):
    """A cylinder (or cone with r2) centred at `at`, along a game axis."""
    bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r, radius2=r if r2 is None else r2, depth=length)
    ob = bpy.context.active_object; ob.name = name
    # Blender cone is along blender z (= game y).
    if axis == 'z': ob.rotation_euler = (math.pi / 2, 0, 0)      # along blender -y = game +z
    elif axis == 'x': ob.rotation_euler = (0, math.pi / 2, 0)
    ob.location = G(*at)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if material: ob.data.materials.append(material)
    return smooth(ob, 50)

def ring(name, r, thick, at, seg=24, material=None, sx=1.0, sy=1.0, minor=5):
    """A torus around the game z axis at `at` (a lip, a band, a flange)."""
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=thick, major_segments=min(seg, 28), minor_segments=minor)
    ob = bpy.context.active_object; ob.name = name
    ob.rotation_euler = (math.pi / 2, 0, 0); ob.scale = (sx, 1, sy)
    ob.location = G(*at)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if material: ob.data.materials.append(material)
    return smooth(ob, 60)

def tube(name, pts, r, material=None, seg=8):
    """A pipe along game-frame points (a curve with a round bevel, converted to mesh)."""
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts): sp.points[i].co = (*G(*p), 1)
    cu.bevel_depth = r; cu.bevel_resolution = max(1, seg // 4 - 1); cu.use_fill_caps = True
    ob = bpy.data.objects.new(name, cu); bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    bpy.ops.object.convert(target='MESH'); ob = bpy.context.active_object
    if material: ob.data.materials.append(material)
    for p in ob.data.polygons: p.use_smooth = True
    return ob

def plate(name, outline, thick, material=None, axis='x', at=0.0, bevel=0.02):
    """An extruded flat shape: outline = [(u, v)] in the plane normal to a game axis ('x': (z, y) at x=at)."""
    bm = bmesh.new()
    def P(u, v, w):
        return G(w, v, u) if axis == 'x' else G(u, w, v)  # 'x': plane x=w with (z=u, y=v); 'y': plane y=w with (x=u, z=v)
    f0 = [bm.verts.new(P(u, v, at - thick / 2)) for (u, v) in outline]
    f1 = [bm.verts.new(P(u, v, at + thick / 2)) for (u, v) in outline]
    bm.faces.new(f0); bm.faces.new(list(reversed(f1)))
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((f0[i], f0[j], f1[j], f1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = obj_from_bm(name, bm, material)
    if bevel:
        bv = ob.modifiers.new('bev', 'BEVEL'); bv.width = bevel; bv.segments = 2; bv.limit_method = 'ANGLE'
    return smooth(ob, 35)

def place(ob, rot=(0, 0, 0), at=(0, 0, 0)):
    """Rotate (game-frame radians, about the origin) then move an object, and apply it."""
    ob.rotation_euler = (rot[0], -rot[2], rot[1]); ob.location = G(*at)
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects: o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob

def join_mirror(obs):
    """Mirror a list of right-side objects across x = 0 (as a modifier: applied on export)."""
    for ob in obs: mirror_x(ob)

def empty(name, at):
    e = bpy.data.objects.new(name, None); e.location = G(*at); bpy.context.collection.objects.link(e)
    return e

def export_glb(path):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True,
                              export_normals=True, export_texcoords=False, export_materials='EXPORT', export_extras=False)

def tri_count():
    dg = bpy.context.evaluated_depsgraph_get(); n = 0
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH':
            me = ob.evaluated_get(dg).to_mesh(); me.calc_loop_triangles(); n += len(me.loop_triangles); ob.evaluated_get(dg).to_mesh_clear()
    return n

def fan_smooth(name, cx, cy, z, r0, r1, n=20, twist=0.7, chord=0.26, steps=4, material=None):
    """Twisted blades as smooth curved strips (several radial steps each), shaded smooth."""
    bm = bmesh.new()
    for i in range(n):
        a = 2 * math.pi * i / n; rows = []
        for k in range(steps + 1):
            r = r0 + (r1 - r0) * k / steps
            tw = twist * (1.0 - 0.5 * k / steps)
            w = chord * (0.75 + 0.35 * k / steps) / r
            row = []
            for side in (-1, 1):
                aa = a + side * w * math.cos(tw); zz = z + side * chord * math.sin(tw) * 0.5
                row.append(bm.verts.new(G(cx + r * math.cos(aa), cy + r * math.sin(aa), zz)))
            rows.append(row)
        for A, B in zip(rows, rows[1:]):
            bm.faces.new((A[0], B[0], B[1], A[1]))
    ob = obj_from_bm(name, bm, material)
    for p in ob.data.polygons: p.use_smooth = True
    return ob

def fan(name, cx, cy, z, r0, r1, n=26, twist=0.55, chord=0.16, material=None):
    """A turbofan face: n overlapping twisted blades from hub radius r0 to tip r1, at depth z (game)."""
    bm = bmesh.new()
    for i in range(n):
        a = 2 * math.pi * i / n
        quad = []
        for (r, side) in ((r0, -1), (r1, -1), (r1, 1), (r0, 1)):
            tw = twist * (1.0 - 0.45 * (r - r0) / (r1 - r0))       # more pitch at the root
            w = chord * (0.8 + 0.4 * (r - r0) / (r1 - r0)) / r       # angular half-width grows outward
            aa = a + side * w * math.cos(tw)
            zz = z + side * chord * math.sin(tw) * 0.5
            quad.append(bm.verts.new(G(cx + r * math.cos(aa), cy + r * math.sin(aa), zz)))
        bm.faces.new(quad)
    ob = obj_from_bm(name, bm, material)
    for p in ob.data.polygons: p.use_smooth = False
    return ob

def petals(name, cx, cy, z0, r, n, length, width, splay=0.14, thick=0.02, material=None):
    """A nozzle crown: n tapered petals rooted on a ring of radius r at z0, pointing back (−z), splayed out."""
    bm = bmesh.new()
    for i in range(n):
        a = 2 * math.pi * (i + 0.5) / n
        ca, sa = math.cos(a), math.sin(a)
        tx, ty = -sa, ca                       # tangent
        rt = r + length * math.sin(splay)      # tip radius (splayed out)
        base = [(r - thick, -width / 2), (r - thick, width / 2), (r + thick, width / 2), (r + thick, -width / 2)]
        vs = [bm.verts.new(G(cx + rr * ca + t * tx, cy + rr * sa + t * ty, z0)) for (rr, t) in base]
        tip = [bm.verts.new(G(cx + (rt - thick * 0.3) * ca, cy + (rt - thick * 0.3) * sa, z0 - length)), bm.verts.new(G(cx + (rt + thick * 0.3) * ca, cy + (rt + thick * 0.3) * sa, z0 - length))]
        bm.faces.new((vs[0], vs[1], tip[0])); bm.faces.new((vs[3], tip[1], vs[2]))
        bm.faces.new((vs[1], vs[2], tip[1], tip[0])); bm.faces.new((vs[0], tip[0], tip[1], vs[3]))
        bm.faces.new((vs[0], vs[3], vs[2], vs[1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = obj_from_bm(name, bm, material)
    return ob

def subsurf_obj(ob, levels=2):
    subsurf(ob, levels); return ob

def tri_report(top=14):
    dg = bpy.context.evaluated_depsgraph_get(); agg = {}
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH':
            me = ob.evaluated_get(dg).to_mesh(); me.calc_loop_triangles()
            k = ob.name.split('.')[0]; agg[k] = agg.get(k, 0) + len(me.loop_triangles); ob.evaluated_get(dg).to_mesh_clear()
    for k, v in sorted(agg.items(), key=lambda x: -x[1])[:top]: print('TRI', k, v)

def _mono_cubic(xs, ys):
    """Fritsch–Carlson monotone cubic through (xs, ys); returns f(x)."""
    n = len(xs); d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [d[0]] + [0.0 if d[i - 1] * d[i] <= 0 else (d[i - 1] + d[i]) / 2 for i in range(1, n - 1)] + [d[-1]]
    for i in range(n - 1):
        if d[i] == 0: m[i] = m[i + 1] = 0; continue
        a, b = m[i] / d[i], m[i + 1] / d[i]; h = a * a + b * b
        if h > 9: t = 3 / math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]
    def f(x):
        i = 0
        while i < n - 2 and x > xs[i + 1]: i += 1
        h = xs[i + 1] - xs[i]; u = (x - xs[i]) / h
        h00, h10, h01, h11 = 2*u**3 - 3*u**2 + 1, u**3 - 2*u**2 + u, -2*u**3 + 3*u**2, u**3 - u**2
        return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1]
    return f

def smooth_loft(name, rings, around=48, steps=60, material=None, cap0=False, cap1=True, angle=50):
    """A loft through superellipse sections (z, cx, cy, rx, ryt, ryb, n) with every parameter on a
    smooth monotone cubic along z, sampled densely — exact shape, no subdivision shrink."""
    rs = sorted(rings, key=lambda r: r[0])
    zs = [r[0] for r in rs]
    fs = [_mono_cubic(zs, [r[k] for r in rs]) for k in range(1, 7)]
    z0, z1 = zs[0], zs[-1]
    dense = []
    for i in range(steps + 1):
        u = i / steps; z = z0 + (z1 - z0) * (0.5 - 0.5 * math.cos(math.pi * u))
        dense.append((z, *[f(z) for f in fs]))
    dense.reverse()   # front to back, like ring_loft
    ob = ring_loft(name, dense, around=around, cap0=cap0, cap1=cap1, material=material)
    return smooth(ob, angle)

def poly_loft(name, stations, profile, steps=48, material=None, cap1=True, angle=28):
    """A loft of a hard-edged polygon section: profile = [(u, v)] in −1..1 (u across, v up; v>0 scales
    by t, v<0 by b), stations = [(z, cx, cy, a, t, b)] smoothed along z (monotone cubic). Edges sharper
    than `angle` stay crisp (chines), the rest shade smooth."""
    rs = sorted(stations, key=lambda r: r[0]); zs = [r[0] for r in rs]
    fs = [_mono_cubic(zs, [r[k] for r in rs]) for k in range(1, 6)]
    bm = bmesh.new(); loops = []
    z0, z1 = zs[-1], zs[0]
    for i in range(steps + 1):
        u = i / steps; z = z0 + (z1 - z0) * (0.5 - 0.5 * math.cos(math.pi * u))
        cx, cy, a, t, b = [f(z) for f in fs]
        loops.append([bm.verts.new(G(cx + pu * a, cy + (pv * t if pv >= 0 else pv * b), z)) for (pu, pv) in profile])
    n = len(profile)
    for A, B in zip(loops, loops[1:]):
        for j in range(n):
            j1 = (j + 1) % n
            bm.faces.new((A[j], A[j1], B[j1], B[j]))
    if cap1: bm.faces.new(list(reversed(loops[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return smooth(obj_from_bm(name, bm, material), angle)
