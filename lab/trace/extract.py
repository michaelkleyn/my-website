"""Turn the journal photo into paintable objects.
For each object: a clean mask (from SAM auto masks, or a SAM box/point prompt), occluders subtracted
(and inpainted), then a 'recipe': outline polygon, k colour layers as polygons, edge polylines.
Writes objects.json, crops/<name>.png (RGBA reference crops) and preview.png (flat render of the recipes)."""
import sys, json, os, numpy as np, cv2, torch
from segment_anything import sam_model_registry, SamPredictor

src, segdir, ckpt, out = sys.argv[1:5]
os.makedirs(os.path.join(out, 'crops'), exist_ok=True)
img = cv2.cvtColor(cv2.imread(src), cv2.COLOR_BGR2RGB)
H, W = img.shape[:2]
auto = np.load(os.path.join(segdir, 'masks.npz'))
AM = [auto[f'arr_{i}'] for i in range(len(auto.files))]

sam = sam_model_registry['vit_b'](checkpoint=ckpt).to('cpu')
pred = SamPredictor(sam)
pred.set_image(img)

def prompt(box=None, points=None, pick='best'):
    pc = np.array(points, dtype=np.float32) if points else None
    pl = np.ones(len(points), dtype=np.int32) if points else None
    bx = np.array(box, dtype=np.float32) if box else None
    masks, scores, _ = pred.predict(point_coords=pc, point_labels=pl, box=bx, multimask_output=True)
    if pick == 'largest': return masks[int(np.argmax([m.sum() for m in masks]))]
    return masks[int(np.argmax(scores))]

def clean(mask, fill_holes=True):
    m = mask.astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    if n > 1:  # keep every piece that is at least 15% of the biggest one (drops crumbs, keeps a split object)
        areas = stats[1:, cv2.CC_STAT_AREA]; keep = [i + 1 for i, a in enumerate(areas) if a >= 0.15 * areas.max()]
        m = np.isin(lab, keep).astype(np.uint8)
    if fill_holes:
        cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        m = np.zeros_like(m); cv2.drawContours(m, cnts, -1, 1, -1)
    return m.astype(bool)

def union(ids): 
    m = np.zeros((H, W), bool)
    for i in ids: m |= AM[i]
    return m

DESK = [1, 2, 3, 6, 7, 8, 10, 16, 24, 27, 30, 32, 36, 48, 50, 55, 58]
# name, how to get the mask, occluders to subtract (names resolved after), z-order = list order
SPEC = [
    ('journal',          {'box': [24, 60, 1586, 1186], 'pick': 'largest'}),
    ('flap',             {'masks': [0, 5, 9], 'nodesk': True}),
    ('strap',            {'masks': [14, 40, 51]}),
    ('map-yosemite',     {'points': [[470, 470], [520, 630], [640, 905], [385, 880], [560, 520]]}),
    ('photo-halfdome',   {'masks': [4]}),
    ('polaroid-left',    {'box': [200, 620, 565, 945]}),
    ('polaroid-right',   {'masks': [11]}),
    ('clip-valley',      {'masks': [17]}),
    ('photo-ranger',     {'masks': [20]}),
    ('photo-man',        {'masks': [34]}),
    ('clip-text',        {'masks': [22]}),
    ('tree',             {'masks': [28]}),
    ('clip-hike',        {'box': [930, 395, 1275, 745]}),
    ('photo-hiker',      {'box': [855, 655, 1095, 835]}),
    ('photo-small',      {'masks': [49]}),
    ('sticker-blue',     {'box': [975, 565, 1032, 614]}),
    ('sticker-yosemite', {'masks': [37]}),
    ('feather',          {'masks': [12]}),
    ('pen',              {'masks': [45]}),
]
OCCLUDE = {  # object: things lying on top of it that must be cut out and inpainted
    'journal': [n for n, _ in SPEC if n not in ('journal', 'flap')],
    'flap': ['strap'],
    'map-yosemite': ['polaroid-left', 'polaroid-right', 'pen', 'photo-halfdome'],
    'polaroid-right': ['pen'],
    'polaroid-left': ['pen'],
    'photo-halfdome': [],
    'clip-text': ['feather', 'pen'],
    'clip-valley': ['feather'],
    'photo-man': ['feather'],
    'clip-hike': ['feather'],
}

raw = {}
for name, how in SPEC:
    if 'notdesk' in how:
        m = ~union(DESK)
    elif 'masks' in how and 'box' in how:
        m = union(how['masks']) | prompt(box=how['box'], pick=how.get('pick', 'best'))
    elif 'masks' in how:
        m = union(how['masks'])
        if how.get('nodesk'):
            desk = cv2.dilate(union(DESK).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
            m = m & ~desk
    else:
        m = prompt(box=how.get('box'), points=how.get('points'), pick=how.get('pick', 'best'))
    raw[name] = clean(m, fill_holes=(name != 'strap'))
# occluder subtraction: the item's own mask minus the things on top of it
masks = {}
for name, _ in SPEC:
    m = raw[name].copy()
    occ = np.zeros((H, W), bool)
    for o in OCCLUDE.get(name, []): occ |= raw[o]
    masks[name] = (m, occ & m)
# make sure objects lower in z don't claim pixels that a higher object owns (only for painting overlap sanity)

def kmeans_layers(pix, k, seed=1):
    lab = cv2.cvtColor(pix.reshape(-1, 1, 3), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    sub = lab if len(lab) < 40000 else lab[np.random.RandomState(seed).choice(len(lab), 40000, replace=False)]
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5)
    _, _, centers = cv2.kmeans(sub, k, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    d = ((lab[:, None, :] - centers[None, :, :]) ** 2).sum(-1)
    return np.argmin(d, axis=1), centers

def polys_from_mask(m, eps_px, min_area):
    cnts, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in cnts:
        a = cv2.contourArea(c)
        if a < min_area: continue
        ap = cv2.approxPolyDP(c, eps_px, True)
        if len(ap) >= 3: out.append([[round(float(p[0][0]), 1), round(float(p[0][1]), 1)] for p in ap])
    return out

objects = []
preview = np.full((H, W, 3), 240, np.uint8)
for name, _ in SPEC:
    m, occ = masks[name]
    ys, xs = np.nonzero(m)
    if len(xs) == 0: print('EMPTY', name); continue
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    pad = 4
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad); x1, y1 = min(W, x1 + pad), min(H, y1 + pad)
    crop = img[y0:y1, x0:x1].copy(); cm = m[y0:y1, x0:x1]; co = occ[y0:y1, x0:x1]
    if co.any():  # fill what the occluders hid
        occd = cv2.dilate(co.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool) & cm
        if name in ('journal', 'flap', 'map-yosemite', 'clip-text', 'clip-hike', 'clip-valley'):
            # paper: each hidden blob takes the median colour of the visible ring around it
            n, lab = cv2.connectedComponents(occd.astype(np.uint8), connectivity=8)
            for bi in range(1, n):
                blob = lab == bi
                ring = cv2.dilate(blob.astype(np.uint8), np.ones((41, 41), np.uint8)).astype(bool) & cm & ~occd
                if ring.sum() < 50: ring = cm & ~occd
                med = np.median(crop[ring], axis=0)
                noise = np.random.RandomState(bi).normal(0, 4, (int(blob.sum()), 3))
                crop[blob] = np.clip(med + noise, 0, 255).astype(np.uint8)
        else:
            filled = cv2.inpaint(crop, occd.astype(np.uint8), 4, cv2.INPAINT_TELEA)
            crop[occd] = filled[occd]
    area = int(cm.sum())
    # outline
    outline = polys_from_mask(cm, 2.0, 0)
    outline = max(outline, key=len) if outline else []
    if len(outline) > 700:
        c = np.array(outline, np.float32).reshape(-1, 1, 2); outline = [[round(float(q[0][0]), 1), round(float(q[0][1]), 1)] for q in cv2.approxPolyDP(c, 3.5, True)]
    # colour layers
    k = 6 if area > 150000 else 5 if area > 30000 else 4
    labels, centers = kmeans_layers(crop[cm], k)
    lab_img = np.full(cm.shape, -1, np.int32); lab_img[cm] = labels
    order = np.argsort(centers[:, 0])[::-1]  # light → dark
    layers = []
    for ci in order:
        lm = (lab_img == ci).astype(np.uint8)
        lm = cv2.morphologyEx(lm, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        lm = cv2.morphologyEx(lm, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        rgb = cv2.cvtColor(np.uint8([[centers[ci]]]), cv2.COLOR_LAB2RGB)[0, 0]
        polys = polys_from_mask(lm, 2.2, max(40, area * 0.0015))
        if polys: layers.append({'color': '#%02x%02x%02x' % tuple(int(v) for v in rgb), 'share': round(float(lm.sum()) / area, 3), 'polys': polys})
    # edge lines (inside the object, away from the outline)
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
    gray = cv2.bilateralFilter(gray, 7, 40, 7)
    edges = cv2.Canny(gray, 50, 140)
    inner = cv2.erode(cm.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    edges[~inner] = 0
    cnts, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    lines = []
    for c in cnts:
        L = cv2.arcLength(c, False)
        if L < 28: continue
        ap = cv2.approxPolyDP(c, 1.6, False)
        if len(ap) >= 2: lines.append((L, [[round(float(p[0][0]), 1), round(float(p[0][1]), 1)] for p in ap]))
    lines.sort(key=lambda t: -t[0])
    cap = 160 if area > 150000 else 90 if area > 30000 else 50
    lines = [l for _, l in lines[:cap]]
    objects.append({'name': name, 'bbox': [int(x0), int(y0), int(x1 - x0), int(y1 - y0)], 'area': area,
                    'outline': outline, 'layers': layers, 'lines': lines})
    # reference crop
    rgba = np.dstack([crop, (cm * 255).astype(np.uint8)])
    cv2.imwrite(os.path.join(out, 'crops', name + '.png'), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
    # flat preview
    for lyr in layers:
        col = tuple(int(lyr['color'][i:i + 2], 16) for i in (1, 3, 5))
        for poly in lyr['polys']:
            cv2.fillPoly(preview, [np.array(poly, np.int32) + [x0, y0]], col)
    for ln in lines:
        cv2.polylines(preview, [np.array(ln, np.int32) + [x0, y0]], False, (60, 50, 40), 1, cv2.LINE_AA)
    if outline:
        cv2.polylines(preview, [np.array(outline, np.int32) + [x0, y0]], True, (30, 25, 20), 2, cv2.LINE_AA)
    print(f'{name:18s} bbox={x0},{y0},{x1-x0}x{y1-y0} area={area//1000}k layers={len(layers)} polys={sum(len(l["polys"]) for l in layers)} lines={len(lines)} outline={len(outline)}')

# review sheets
ov = img.copy()
rng = np.random.RandomState(5)
for i, (name, _) in enumerate(SPEC):
    m, occ = masks[name]
    color = rng.randint(60, 255, 3)
    ov[m] = (ov[m] * 0.45 + color * 0.55).astype(np.uint8)
    cnts, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(ov, cnts, -1, tuple(int(c) for c in color), 2)
    ys, xs = np.nonzero(m); cx, cy = int(xs.mean()), int(ys.mean())
    cv2.putText(ov, name, (cx - 40, cy), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 4); cv2.putText(ov, name, (cx - 40, cy), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
cv2.imwrite(os.path.join(out, 'masks-overlay.png'), cv2.cvtColor(ov, cv2.COLOR_RGB2BGR))
sheet = np.full((H, W, 3), 255, np.uint8)
for o in objects:
    x, y, w, h = o['bbox']; rgba = cv2.cvtColor(cv2.imread(os.path.join(out, 'crops', o['name'] + '.png'), cv2.IMREAD_UNCHANGED), cv2.COLOR_BGRA2RGBA)
    a = rgba[:, :, 3:4] / 255.0
    sheet[y:y + h, x:x + w] = (rgba[:, :, :3] * a + sheet[y:y + h, x:x + w] * (1 - a)).astype(np.uint8)
cv2.imwrite(os.path.join(out, 'cutouts.png'), cv2.cvtColor(sheet, cv2.COLOR_RGB2BGR))
json.dump({'source': os.path.basename(src), 'W': W, 'H': H, 'objects': objects}, open(os.path.join(out, 'objects.json'), 'w'), separators=(',', ':'))
cv2.imwrite(os.path.join(out, 'preview.png'), cv2.cvtColor(preview, cv2.COLOR_RGB2BGR))
print('objects.json', os.path.getsize(os.path.join(out, 'objects.json')) // 1024, 'KB')
