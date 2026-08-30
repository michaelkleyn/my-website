"""Journal photo → paintable objects, v2 (clean-up pass).
Per object: SAM mask (auto ids or box/point prompt) → cleaned + eroded → flat items rectified through a
4-corner homography (or min-area rect) → occluders filled → lighting flattened + mean-shift smoothed →
recipe: outline (straight rect or smoothed contour), k colour layers as polygons, strong edge lines.
Per-object overrides come from overrides.json. Writes objects.json, crops/, masks-overlay.png, cutouts.png."""
import sys, json, os, math, numpy as np, cv2, torch
from segment_anything import sam_model_registry, SamPredictor

src, segdir, ckpt, out = sys.argv[1:5]
OVR = json.load(open(sys.argv[5])) if len(sys.argv) > 5 and os.path.exists(sys.argv[5]) else {}
os.makedirs(os.path.join(out, 'crops'), exist_ok=True)
img = cv2.cvtColor(cv2.imread(src), cv2.COLOR_BGR2RGB)
H, W = img.shape[:2]
auto = np.load(os.path.join(segdir, 'masks.npz'))
AM = [auto[f'arr_{i}'] for i in range(len(auto.files))]
sam = sam_model_registry['vit_b'](checkpoint=ckpt).to('cpu')
pred = SamPredictor(sam); pred.set_image(img)

DESK = [1, 2, 3, 6, 7, 8, 10, 16, 24, 27, 30, 32, 36, 48, 50, 55, 58]
# name, mask source, geometry: flat (rectify), rect (straight outline)
SPEC = [
    ('journal',          {'box': [24, 60, 1586, 1186], 'pick': 'largest'}),
    ('flap',             {'masks': [0, 5, 9], 'nodesk': True}),
    ('strap',            {'masks': [14, 40, 51], 'holes': False}),
    ('map-yosemite',     {'points': [[470, 470], [520, 630], [640, 905], [385, 880], [560, 520]], 'flat': True, 'rect': True}),
    ('photo-halfdome',   {'masks': [4], 'flat': True, 'rect': True}),
    ('polaroid-left',    {'box': [205, 625, 555, 938], 'points': [[300, 770], [335, 885], [420, 700]], 'neg': [[590, 760], [470, 620], [250, 960]], 'flat': True, 'rect': True}),
    ('polaroid-right',   {'masks': [11], 'flat': True, 'rect': True}),
    ('clip-valley',      {'masks': [17], 'flat': True, 'rect': True}),
    ('photo-ranger',     {'masks': [20], 'flat': True, 'rect': True}),
    ('photo-man',        {'masks': [34], 'flat': True}),
    ('clip-text',        {'masks': [22], 'flat': True}),
    ('tree',             {'masks': [28]}),
    ('clip-hike',        {'box': [930, 395, 1275, 745], 'flat': True}),
    ('photo-hiker',      {'box': [855, 655, 1095, 835], 'flat': True, 'rect': True}),
    ('photo-small',      {'masks': [49]}),
    ('sticker-blue',     {'box': [975, 565, 1032, 614], 'flat': True, 'rect': True}),
    ('sticker-yosemite', {'masks': [37], 'flat': True, 'rect': True}),
    ('feather',          {'masks': [12]}),
    ('pen',              {'masks': [45]}),
]
OCCLUDE = {
    'journal': [n for n, _ in SPEC if n not in ('journal', 'flap')],
    'flap': ['strap'],
    'map-yosemite': ['polaroid-left', 'polaroid-right', 'pen', 'photo-halfdome'],
    'polaroid-right': ['pen'], 'polaroid-left': ['pen'],
    'clip-text': ['feather', 'pen'], 'clip-valley': ['feather'], 'photo-man': ['feather'], 'clip-hike': ['feather'],
}
PAPER = ('journal', 'flap', 'map-yosemite', 'clip-text', 'clip-hike', 'clip-valley')
UNDER = {  # the surface continues beneath these (SAM segments around them): add their footprint, then fill it
    'journal': [n for n, _ in SPEC if n not in ('journal', 'flap')],
    'flap': ['strap'],
    'map-yosemite': ['polaroid-left', 'polaroid-right', 'pen', 'photo-halfdome'],
}
DEFAULTS = {'erode': 2, 'k': None, 'lines': 1.0, 'line_min': 30, 'edge_lo': 60, 'edge_hi': 150, 'flatten': 0.7, 'smooth': 7, 'eps': 2.0, 'ms': True}

def prompt(box=None, points=None, pick='best', neg=None):
    pts = (points or []) + (neg or [])
    pc = np.array(pts, dtype=np.float32) if pts else None
    pl = np.array([1] * len(points or []) + [0] * len(neg or []), dtype=np.int32) if pts else None
    bx = np.array(box, dtype=np.float32) if box else None
    masks, scores, _ = pred.predict(point_coords=pc, point_labels=pl, box=bx, multimask_output=True)
    return masks[int(np.argmax([m.sum() for m in masks]))] if pick == 'largest' else masks[int(np.argmax(scores))]

def union(ids):
    m = np.zeros((H, W), bool)
    for i in ids: m |= AM[i]
    return m

def clean(mask, fill_holes=True):
    m = mask.astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    if n > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]; keep = [i + 1 for i, a in enumerate(areas) if a >= 0.15 * areas.max()]
        m = np.isin(lab, keep).astype(np.uint8)
    if fill_holes:
        cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        m = np.zeros_like(m); cv2.drawContours(m, cnts, -1, 1, -1)
    return m.astype(bool)

UP_ANGLE = -27.0  # the journal's tilt in the photo; 'top' edges of flat items run roughly this way

def order_quad(q):
    q = np.array(q, np.float32).reshape(4, 2)
    area = 0.5 * sum(q[i][0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * q[i][1] for i in range(4))
    if area < 0: q = q[::-1].copy()  # make it clockwise in image space (tl → tr → br → bl)
    best, bd = 0, 1e9
    for i in range(4):
        a, b = q[i], q[(i + 1) % 4]
        ang = math.degrees(math.atan2(float(b[1] - a[1]), float(b[0] - a[0])))
        d = abs((ang - UP_ANGLE + 180) % 360 - 180)
        if d < bd: bd, best = d, i
    return np.roll(q, -best, axis=0).astype(np.float32)

def fit_quad(mask):
    mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, np.ones((15, 15), np.uint8))
    cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(cnts, key=cv2.contourArea); area = cv2.contourArea(c); per = cv2.arcLength(c, True)
    hull = cv2.convexHull(c)
    for f in np.linspace(0.01, 0.12, 24):
        ap = cv2.approxPolyDP(hull, f * per, True)
        if len(ap) == 4:
            q = order_quad(ap)
            if abs(cv2.contourArea(q) - area) / area < 0.25: return q, 'quad'
            break
    box = cv2.boxPoints(cv2.minAreaRect(c))
    return order_quad(box), 'rect'

def smooth_contour(c, win):
    pts = c.reshape(-1, 2).astype(np.float32)
    if len(pts) < win * 2: return pts
    k = np.ones(win) / win
    xs = np.convolve(np.concatenate([pts[-win:, 0], pts[:, 0], pts[:win, 0]]), k, 'same')[win:-win]
    ys = np.convolve(np.concatenate([pts[-win:, 1], pts[:, 1], pts[:win, 1]]), k, 'same')[win:-win]
    return np.stack([xs, ys], 1)

def polys_from_mask(m, eps_px, min_area):
    cnts, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    outp = []
    for c in cnts:
        if cv2.contourArea(c) < min_area: continue
        ap = cv2.approxPolyDP(c, eps_px, True)
        if len(ap) >= 3: outp.append([[round(float(p[0][0]), 1), round(float(p[0][1]), 1)] for p in ap])
    return outp

def flatten_light(rgb, mask, strength):
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    L = lab[:, :, 0]
    sigma = max(15, min(rgb.shape[:2]) / 6)
    Lm = L.copy(); Lm[~mask] = np.median(L[mask]) if mask.any() else 128
    base = cv2.GaussianBlur(Lm, (0, 0), sigma)
    target = float(np.mean(L[mask])) if mask.any() else 128.0
    flat = L + (target - base) * strength
    lab[:, :, 0] = np.clip(flat, 0, 255)
    return cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2RGB)

def kmeans_layers(pix, k, seed=1):
    lab = cv2.cvtColor(pix.reshape(-1, 1, 3), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    sub = lab if len(lab) < 40000 else lab[np.random.RandomState(seed).choice(len(lab), 40000, replace=False)]
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.5)
    _, _, centers = cv2.kmeans(sub, k, None, crit, 4, cv2.KMEANS_PP_CENTERS)
    d = ((lab[:, None, :] - centers[None, :, :]) ** 2).sum(-1)
    return np.argmin(d, axis=1), centers

# ------------------------------------------------------------------ masks
raw = {}
for name, how in SPEC:
    if 'masks' in how:
        m = union(how['masks'])
        if how.get('nodesk'):
            m &= ~cv2.dilate(union(DESK).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    else:
        m = prompt(box=how.get('box'), points=how.get('points'), pick=how.get('pick', 'best'), neg=how.get('neg'))
    raw[name] = clean(m, fill_holes=how.get('holes', True))

objects = []
for name, how in SPEC:
    o = dict(DEFAULTS); o.update(how); o.update(OVR.get(name, {}))
    m = raw[name].copy()
    for u in UNDER.get(name, []): m |= raw[u]
    if name in UNDER: m = clean(m, fill_holes=True)
    occ = np.zeros((H, W), bool)
    for oc in OCCLUDE.get(name, []): occ |= raw[oc]
    if o['erode'] > 0:
        m = cv2.erode(m.astype(np.uint8), np.ones((2 * o['erode'] + 1,) * 2, np.uint8)).astype(bool)
    occ &= m
    ys, xs = np.nonzero(m)
    if len(xs) == 0: print('EMPTY', name); continue

    # ---- geometry: rectify flat items, or crop organic ones
    if o.get('flat'):
        quad, kind = fit_quad(m)
        tl, tr, br, bl = quad
        w = int(round((np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2))
        h = int(round((np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2))
        w, h = max(w, 8), max(h, 8)
        Hm = cv2.getPerspectiveTransform(quad, np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32))
        crop = cv2.warpPerspective(img, Hm, (w, h), flags=cv2.INTER_LINEAR)
        cm = cv2.warpPerspective(m.astype(np.uint8), Hm, (w, h), flags=cv2.INTER_NEAREST).astype(bool)
        co = cv2.warpPerspective(occ.astype(np.uint8), Hm, (w, h), flags=cv2.INTER_NEAREST).astype(bool)
        if o.get('rect'):
            cm[:] = True; cm[:2, :] = cm[-2:, :] = cm[:, :2] = cm[:, -2:] = False
        rot = math.degrees(math.atan2(float(tr[1] - tl[1]), float(tr[0] - tl[0])))
        center = [float(quad[:, 0].mean()), float(quad[:, 1].mean())]
        geom = {'flat': True, 'kind': kind, 'quad': [[round(float(p[0]), 1), round(float(p[1]), 1)] for p in quad]}
    else:
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        crop = img[y0:y1, x0:x1].copy(); cm = m[y0:y1, x0:x1]; co = occ[y0:y1, x0:x1]
        w, h = int(x1 - x0), int(y1 - y0); rot = 0.0; center = [x0 + w / 2, y0 + h / 2]
        geom = {'flat': False}
    area = int(cm.sum())

    # ---- fill what was hidden under other things
    if co.any():
        occd = cv2.dilate(co.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool) & cm
        if name in PAPER:
            n, lab = cv2.connectedComponents(occd.astype(np.uint8), connectivity=8)
            for bi in range(1, n):
                blob = lab == bi
                ring = cv2.dilate(blob.astype(np.uint8), np.ones((41, 41), np.uint8)).astype(bool) & cm & ~occd
                if ring.sum() < 50: ring = cm & ~occd
                med = np.median(crop[ring], axis=0)
                crop[blob] = np.clip(med + np.random.RandomState(bi).normal(0, 3, (int(blob.sum()), 3)), 0, 255).astype(np.uint8)
            # soften the filled patches into their surroundings so they don't quantise into ghost rectangles
            soft = cv2.GaussianBlur(crop, (0, 0), 14)
            zone = cv2.dilate(occd.astype(np.uint8), np.ones((25, 25), np.uint8)).astype(bool) & cm
            crop[zone] = soft[zone]
        else:
            crop[occd] = cv2.inpaint(crop, occd.astype(np.uint8), 5, cv2.INPAINT_TELEA)[occd]

    # ---- pixel clean-up: flatten lighting, smooth regions
    if o['flatten'] > 0: crop = flatten_light(crop, cm, o['flatten'])
    work = cv2.pyrMeanShiftFiltering(cv2.cvtColor(crop, cv2.COLOR_RGB2BGR), 7, 18) if o['ms'] else cv2.cvtColor(crop, cv2.COLOR_RGB2BGR)
    work = cv2.cvtColor(work, cv2.COLOR_BGR2RGB)

    # ---- outline
    if o.get('rect'):
        outline = [[1.0, 1.0], [w - 1.0, 1.0], [w - 1.0, h - 1.0], [1.0, h - 1.0]]
    else:
        cnts, _ = cv2.findContours(cm.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        c = max(cnts, key=cv2.contourArea)
        sm = smooth_contour(c, o['smooth'])
        ap = cv2.approxPolyDP(sm.reshape(-1, 1, 2).astype(np.float32), o['eps'], True)
        outline = [[round(float(p[0][0]), 1), round(float(p[0][1]), 1)] for p in ap]
        if len(outline) > 600:
            ap = cv2.approxPolyDP(sm.reshape(-1, 1, 2).astype(np.float32), 3.5, True)
            outline = [[round(float(p[0][0]), 1), round(float(p[0][1]), 1)] for p in ap]

    # ---- colour layers (light → dark)
    k = o['k'] or (6 if area > 150000 else 5 if area > 30000 else 4)
    labels, centers = kmeans_layers(work[cm], k)
    lab_img = np.full(cm.shape, -1, np.int32); lab_img[cm] = labels
    layers = []
    for ci in np.argsort(centers[:, 0])[::-1]:
        lm = (lab_img == ci).astype(np.uint8)
        lm = cv2.morphologyEx(lm, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        lm = cv2.morphologyEx(lm, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        rgb = cv2.cvtColor(np.uint8([[centers[ci]]]), cv2.COLOR_LAB2RGB)[0, 0]
        polys = polys_from_mask(lm, 2.2, max(40, area * 0.0015))
        if polys: layers.append({'color': '#%02x%02x%02x' % tuple(int(v) for v in rgb), 'share': round(float(lm.sum()) / area, 3), 'polys': polys})

    # ---- strong edge lines, away from the outline
    gray = cv2.cvtColor(work, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, o['edge_lo'], o['edge_hi'])
    inner = cv2.erode(cm.astype(np.uint8), np.ones((11, 11), np.uint8)).astype(bool)
    edges[~inner] = 0
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0); gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1); mag = np.hypot(gx, gy)
    cnts, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    lines = []
    for c in cnts:
        L = cv2.arcLength(c, False)
        if L < o['line_min']: continue
        pts = c.reshape(-1, 2)
        strength = float(np.mean(mag[pts[:, 1], pts[:, 0]]))
        ap = cv2.approxPolyDP(c, 1.6, False)
        if len(ap) >= 2: lines.append((L * strength, [[round(float(p[0][0]), 1), round(float(p[0][1]), 1)] for p in ap]))
    lines.sort(key=lambda t: -t[0])
    cap = int(max(6, area / 2500) * o['lines'])
    lines = [l for _, l in lines[:cap]]

    base = np.median(work[cm], axis=0) if cm.any() else np.array([200, 200, 200])
    objects.append({'name': name, 'base': '#%02x%02x%02x' % tuple(int(v) for v in base), 'bbox': [int(round(center[0] - w / 2)), int(round(center[1] - h / 2)), w, h],
                    'center': [round(center[0], 1), round(center[1], 1)], 'rot': round(rot, 2), 'area': area, 'geom': geom,
                    'outline': outline, 'layers': layers, 'lines': lines, 'paint': o.get('paint', {})})
    rgba = np.dstack([crop, (cm * 255).astype(np.uint8)])
    cv2.imwrite(os.path.join(out, 'crops', name + '.png'), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
    print(f'{name:18s} {w}x{h} rot={rot:6.1f} {geom.get("kind","")} area={area//1000}k layers={len(layers)} polys={sum(len(l["polys"]) for l in layers)} lines={len(lines)} outline={len(outline)}')

# ------------------------------------------------------------------ review sheets
ov = img.copy(); rng = np.random.RandomState(5)
for name, _ in SPEC:
    m = raw[name]; color = rng.randint(60, 255, 3)
    ov[m] = (ov[m] * 0.45 + color * 0.55).astype(np.uint8)
    cnts, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(ov, cnts, -1, tuple(int(c) for c in color), 2)
for o in objects:
    if o['geom'].get('flat'):
        q = np.array(o['geom']['quad'], np.int32); cv2.polylines(ov, [q], True, (255, 255, 255), 2)
    cx, cy = int(o['center'][0]), int(o['center'][1])
    cv2.putText(ov, o['name'], (cx - 40, cy), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 4); cv2.putText(ov, o['name'], (cx - 40, cy), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
cv2.imwrite(os.path.join(out, 'masks-overlay.png'), cv2.cvtColor(ov, cv2.COLOR_RGB2BGR))
json.dump({'source': os.path.basename(src), 'W': W, 'H': H, 'objects': objects}, open(os.path.join(out, 'objects.json'), 'w'), separators=(',', ':'))
print('objects.json', os.path.getsize(os.path.join(out, 'objects.json')) // 1024, 'KB')
