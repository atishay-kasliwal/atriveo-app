# Atriveo landing route motion: resume sheets travel the page's own route (Find > Evidence > Resume > Submit) in a seamless loop.
# Square render that sits behind the page's SVG route (440 x 440 coordinate space, same path), so geometry matches the page.
# Run: blender -b -P route2.py -- <out dir> [still_frame]
import bpy, math, sys, os
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = args[0] if args else "/tmp/route"
STILL = int(args[1]) if len(args) > 1 else None
os.makedirs(OUT, exist_ok=True)

FPS, SECONDS = 30, 5
N = FPS * SECONDS
RES = 880
def lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def hexcol(h): return tuple(lin(int(h[i:i + 2], 16) / 255) for i in (1, 3, 5))
BG = (0.0, 0.0, 0.0)                 # pure black: the page blends the video with mix-blend-mode: screen, so black disappears into the page ground (--paper #0b0f17)
BLUE = hexcol("#6e98ff")             # the page's path blue (--blue)
BLUE_DEEP = hexcol("#2455e8")        # the page's action blue (--action)

bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
scene = bpy.context.scene
scene.frame_start, scene.frame_end = 1, N
scene.render.fps = FPS
scene.render.resolution_x = scene.render.resolution_y = RES
scene.render.resolution_percentage = 100
for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try: scene.render.engine = eng; break
    except TypeError: pass
try: scene.eevee.taa_render_samples = 64
except Exception: pass
try: scene.render.use_motion_blur = True; scene.render.motion_blur_shutter = 0.35
except Exception: pass
try: scene.eevee.use_motion_blur = True; scene.eevee.motion_blur_shutter = 0.35
except Exception: pass
scene.view_settings.view_transform = "Standard"
world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
bgn = world.node_tree.nodes["Background"]; bgn.inputs[0].default_value = (*BG, 1); bgn.inputs[1].default_value = 1.0

# ---- materials -------------------------------------------------------------------------------------------------------------
def new_mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    for x in list(m.node_tree.nodes): m.node_tree.nodes.remove(x)
    try: m.surface_render_method = "BLENDED"
    except Exception: pass
    return m, m.node_tree.nodes, m.node_tree.links

def solid(name, color, rough=0.5):
    m, n, l = new_mat(name); out = n.new("ShaderNodeOutputMaterial"); b = n.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (*color, 1); b.inputs["Roughness"].default_value = rough
    l.new(b.outputs[0], out.inputs[0]); return m

def emit(name, color, strength):
    m, n, l = new_mat(name); out = n.new("ShaderNodeOutputMaterial"); e = n.new("ShaderNodeEmission")
    e.inputs[0].default_value = (*color, 1); e.inputs[1].default_value = strength; l.new(e.outputs[0], out.inputs[0]); return m

def glow(name, color, strength, radius, power=2.4):
    """Soft radial glow for a flat disc of the given radius: bright in the middle, fading smoothly to nothing at the edge."""
    m, n, l = new_mat(name); out = n.new("ShaderNodeOutputMaterial")
    tc = n.new("ShaderNodeTexCoord"); ln = n.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"
    dv = n.new("ShaderNodeMath"); dv.operation = "DIVIDE"; dv.inputs[1].default_value = radius
    inv = n.new("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.inputs[0].default_value = 1.0; inv.use_clamp = True
    pw = n.new("ShaderNodeMath"); pw.operation = "POWER"; pw.inputs[1].default_value = power
    l.new(tc.outputs["Object"], ln.inputs[0]); l.new(ln.outputs["Value"], dv.inputs[0]); l.new(dv.outputs[0], inv.inputs[1]); l.new(inv.outputs[0], pw.inputs[0])
    tr = n.new("ShaderNodeBsdfTransparent"); em = n.new("ShaderNodeEmission"); em.inputs[0].default_value = (*color, 1); em.inputs[1].default_value = strength
    mix = n.new("ShaderNodeMixShader"); l.new(pw.outputs[0], mix.inputs[0]); l.new(tr.outputs[0], mix.inputs[1]); l.new(em.outputs[0], mix.inputs[2]); l.new(mix.outputs[0], out.inputs[0])
    return m

# ---- the page's route (SVG 440 x 440, 1 unit = 40 px) -----------------------------------------------------------------------
def P(x, y): return Vector(((x - 220) / 40.0, -(y - 220) / 40.0, 0))
def quad(a, c, b, steps=16): return [a * (1 - k / steps) ** 2 + c * (2 * (k / steps) * (1 - k / steps)) + b * (k / steps) ** 2 for k in range(1, steps + 1)]
def line(a, b, steps=20): return [a.lerp(b, k / steps) for k in range(1, steps + 1)]
# M80 60 H295 Q350 60 350 115 V135 Q350 190 295 190 H145 Q90 190 90 245 V265 Q90 320 145 320 H300 Q350 320 350 375 V390
path = [P(80, 60)]
for seg in (("L", (295, 60)), ("Q", (350, 60), (350, 115)), ("L", (350, 135)), ("Q", (350, 190), (295, 190)), ("L", (145, 190)),
            ("Q", (90, 190), (90, 245)), ("L", (90, 265)), ("Q", (90, 320), (145, 320)), ("L", (300, 320)), ("Q", (350, 320), (350, 375)), ("L", (350, 390))):
    cur = path[-1]
    path += line(cur, P(*seg[1])) if seg[0] == "L" else quad(cur, P(*seg[1]), P(*seg[2]))
lengths = [0.0]
for i in range(1, len(path)): lengths.append(lengths[-1] + (path[i] - path[i - 1]).length)
TOTAL = lengths[-1]
def at(t):
    d = max(0.0, min(1.0, t)) * TOTAL; lo, hi = 0, len(path) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if lengths[mid] <= d: lo = mid
        else: hi = mid
    f = (d - lengths[lo]) / max(1e-9, lengths[hi] - lengths[lo])
    return path[lo].lerp(path[hi], f), (path[hi] - path[lo]).normalized()
STOPS = [P(80, 60), P(350, 125), P(90, 255), P(350, 390)]
STOP_AT = [0.0, 0.3089, 0.6515, 1.0]            # the page's `at` values: the share of the path where each stop sits

# A soft glow along the route (the page draws the crisp line itself, on top of this)
def tube(radius, material, name):
    cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = radius; cu.bevel_resolution = 5
    sp = cu.splines.new("POLY"); sp.points.add(len(path) - 1)
    for i, p in enumerate(path): sp.points[i].co = (p.x, p.y, -0.1, 1)
    ob = bpy.data.objects.new(name, cu); scene.collection.objects.link(ob); ob.data.materials.append(material); return ob
tube(0.30, emit("halo_wide", BLUE_DEEP, 0.9), "halo_wide").hide_render = True   # kept for experiments, off by default
tube(0.11, emit("halo", BLUE, 1.2), "halo").hide_render = True

# Stops: a soft glow disc (it blooms when a sheet arrives) under the page's buttons
glows = []
for i, c in enumerate(STOPS):
    bpy.ops.mesh.primitive_cylinder_add(radius=1.5, depth=0.01, location=(c.x, c.y, -0.2), vertices=96)
    g = bpy.context.active_object; g.data.materials.append(glow(f"glow{i}", BLUE, 0.85, 1.5, power=2.8)); glows.append(g)

# Resume sheet
def make_sheet(name):
    bpy.ops.mesh.primitive_cube_add(size=1); page = bpy.context.active_object; page.name = name
    page.scale = (0.74, 0.96, 0.025); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bev = page.modifiers.new("b", "BEVEL"); bev.width = 0.025; bev.segments = 3
    page.data.materials.append(solid(name + "_paper", (0.88, 0.92, 1.0), rough=0.6))
    ink = solid(name + "_ink", hexcol("#5b6b8c"), rough=0.8); head = solid(name + "_head", BLUE_DEEP, rough=0.5)
    heads = [(0.40, 0.34), (0.30, 0.52)]
    rows = [(0.18, 0.54), (0.08, 0.60), (-0.02, 0.50), (-0.12, 0.57), (-0.22, 0.40)]
    for y, w in heads + rows:
        bpy.ops.mesh.primitive_cube_add(size=1); b = bpy.context.active_object
        b.scale = (w, 0.035 if (y, w) in heads else 0.028, 0.01); b.location = (-0.1 + (w - 0.6) * 0.0, y, 0.016)
        b.data.materials.append(head if (y, w) in heads else ink); b.parent = page
    return page
sheets = [make_sheet(f"sheet{i}") for i in range(2)]   # offset half a loop, so one is always moving while the other rests at a stop

def smooth(x): x = max(0.0, min(1.0, x)); return x * x * (3 - 2 * x)
def route_t(u):
    """Loop phase u in [0,1) -> share of the path: three legs, each eased, so a sheet lingers at every stop."""
    k = min(2, int(u * 3)); p = u * 3 - k
    m = smooth((p - 0.10) / 0.80)
    return STOP_AT[k] + (STOP_AT[k + 1] - STOP_AT[k]) * m

SH = len(sheets)
for si, sh in enumerate(sheets):
    for f in range(1, N + 1):
        u = ((f - 1) / N + si / SH) % 1.0
        t = route_t(u); p, tan = at(t)
        s = smooth(u / 0.09) * smooth((1 - u) / 0.09)
        sh.location = (p.x, p.y, 0.25 + 0.04 * math.sin(u * math.tau * 3))
        sh.rotation_euler = (math.radians(12) * math.sin(u * math.tau * 2), math.radians(-14) + math.radians(8) * math.sin(u * math.tau * 3), math.radians(5) * math.sin(u * math.tau * 2 + si))
        sh.scale = (s, s, s)
        for key in ("location", "rotation_euler", "scale"): sh.keyframe_insert(key, frame=f)

# Light sparks trailing each sheet
TRAIL = 8
spark = emit("spark", hexcol("#a9c3ff"), 9.0)
for si in range(SH):
    for k in range(1, TRAIL + 1):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.06, segments=12, ring_count=8); sp = bpy.context.active_object; sp.data.materials.append(spark)
        for f in range(1, N + 1):
            u = (((f - 1) / N + si / SH) - k * 0.006) % 1.0
            p, tan = at(route_t(u))
            fade = smooth(u / 0.09) * smooth((1 - u) / 0.09) * (1 - k / (TRAIL + 1)) ** 1.4
            off = 0.14 * math.sin(u * math.tau * 10 + k * 1.7)
            sp.location = (p.x - tan.y * off, p.y + tan.x * off, 0.1); sp.scale = (fade,) * 3
            sp.keyframe_insert("location", frame=f); sp.keyframe_insert("scale", frame=f)

# Stop glows bloom while a sheet is at the stop
for g, at_t in zip(glows, STOP_AT):
    for f in range(1, N + 1):
        pulse = 0.0
        for si in range(SH):
            u = ((f - 1) / N + si / SH) % 1.0
            d = min(abs(route_t(u) - at_t), 1.0)
            pulse = max(pulse, math.exp(-(d ** 2) / (2 * 0.03 ** 2)) * smooth(u / 0.09) * smooth((1 - u) / 0.09))
        sc = 0.45 + 0.85 * pulse
        g.scale = (sc, sc, 1); g.keyframe_insert("scale", frame=f)

# Camera: orthographic, exactly the 440 x 440 drawing (11 units square)
cam = bpy.data.cameras.new("cam"); cam.type = "ORTHO"; cam.ortho_scale = 11.0
cobj = bpy.data.objects.new("cam", cam); scene.collection.objects.link(cobj); scene.camera = cobj
cobj.location = (0, 0, 30); cobj.rotation_euler = (0, 0, 0)
sun = bpy.data.lights.new("sun", "SUN"); sun.energy = 2.6; sun.color = (0.85, 0.9, 1.0)
so = bpy.data.objects.new("sun", sun); so.rotation_euler = (math.radians(32), math.radians(-24), 0); scene.collection.objects.link(so)
fill = bpy.data.lights.new("fill", "AREA"); fill.energy = 700; fill.size = 12; fill.color = (0.45, 0.6, 1.0)
fo = bpy.data.objects.new("fill", fill); fo.location = (0, 2, 12); scene.collection.objects.link(fo)

scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"
if STILL:
    scene.frame_set(STILL); scene.render.filepath = os.path.join(OUT, f"still_{STILL:03d}.png"); bpy.ops.render.render(write_still=True)
else:
    scene.render.filepath = os.path.join(OUT, "f_"); bpy.ops.render.render(animation=True)
print("done", OUT)
