"""Decompose the illustrated journal into parts: shadow, cover, page block, left page, right page, stitches.
Writes parts/<name>.png (RGBA cutouts), parts.json (bbox + z-order), masks-overlay.png and exploded.png for review."""
import sys, json, os, numpy as np, cv2, torch
from segment_anything import sam_model_registry, SamPredictor
src, segdir, ckpt, out = sys.argv[1:5]
os.makedirs(out, exist_ok=True)
img = cv2.cvtColor(cv2.imread(src), cv2.COLOR_BGR2RGB); H, W = img.shape[:2]
auto = np.load(os.path.join(segdir, 'masks.npz')); AM = [auto[f'arr_{i}'] for i in range(len(auto.files))]
sam = sam_model_registry['vit_b'](checkpoint=ckpt).to('cpu'); pred = SamPredictor(sam); pred.set_image(img)

def prompt(box=None, points=None, neg=None, pick='best'):
    pts = (points or []) + (neg or [])
    pc = np.array(pts, np.float32) if pts else None
    pl = np.array([1] * len(points or []) + [0] * len(neg or []), np.int32) if pts else None
    bx = np.array(box, np.float32) if box else None
    masks, scores, _ = pred.predict(point_coords=pc, point_labels=pl, box=bx, multimask_output=True)
    return masks[int(np.argmax([m.sum() for m in masks]))] if pick == 'largest' else masks[int(np.argmax(scores))]

def clean(mask, min_frac=0.15, fill_holes=True, k=7):
    m = mask.astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8)); m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    if n > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]; keep = [i + 1 for i, a in enumerate(areas) if a >= min_frac * areas.max()]
        m = np.isin(lab, keep).astype(np.uint8)
    if fill_holes:
        cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE); m = np.zeros_like(m); cv2.drawContours(m, cnts, -1, 1, -1)
    return m.astype(bool)

left_block, right_block = AM[0], AM[1]
whole = clean(prompt(box=[70, 55, 1425, 1062], pick='largest') | left_block | right_block | AM[2] | AM[3])
page_left = clean(prompt(box=[150, 225, 805, 955], points=[[420, 600], [300, 400], [600, 800]], neg=[[118, 700], [500, 995], [90, 420]]))
page_right = clean(prompt(box=[600, 95, 1265, 890], points=[[950, 480], [800, 250], [1100, 750]], neg=[[1235, 520], [1000, 935], [1300, 300]]))
rim = clean(AM[3], min_frac=0.2, fill_holes=False, k=5)
block = clean((left_block | right_block) & ~(page_left | page_right) & ~rim, min_frac=0.05, fill_holes=False, k=5)
cover = clean((whole & ~(left_block | right_block)) | rim, min_frac=0.03, fill_holes=False, k=5)
stitches = np.zeros((H, W), bool)
for bx in ([606, 312, 648, 344], [646, 442, 690, 476], [696, 592, 740, 626], [746, 736, 792, 770]):
    m = prompt(box=bx)
    if 20 < m.sum() < 4000: stitches |= m
# soft shadow: darker-than-paper pixels outside the journal
L = cv2.cvtColor(img, cv2.COLOR_RGB2LAB)[:, :, 0].astype(np.float32)
paper = float(np.median(L[~cv2.dilate(whole.astype(np.uint8), np.ones((41, 41), np.uint8)).astype(bool)]))
outside = ~cv2.dilate(whole.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
shadow_a = np.clip((paper - L) / 70.0, 0, 0.85) * outside
shadow_a[shadow_a < 0.1] = 0  # paper grain must not leave a faint box around the shadow
# the cast shadow lives within a band around the journal; farther out it is just paper texture
_dist = cv2.distanceTransform((~whole).astype(np.uint8), cv2.DIST_L2, 3)
shadow_a *= np.clip(1 - (_dist - 40) / 110, 0, 1)
shadow_a = cv2.GaussianBlur(shadow_a, (0, 0), 4)
shadow_a[shadow_a < 0.01] = 0

PARTS = [('shadow', None), ('cover', cover), ('block', block | page_left | page_right), ('page-left', page_left), ('page-right', page_right), ('stitches', stitches)]
parts = []
for z, (name, m) in enumerate(PARTS):
    if name == 'shadow':
        ys, xs = np.nonzero(shadow_a > 0.02)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        rgba = np.dstack([np.full((y1 - y0, x1 - x0, 3), (54, 40, 28), np.uint8), (shadow_a[y0:y1, x0:x1] * 255).astype(np.uint8)])
    else:
        if not m.any(): print('EMPTY', name); continue
        ys, xs = np.nonzero(m); x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        crop = img[y0:y1, x0:x1].copy(); cm = m[y0:y1, x0:x1]
        if name == 'cover':  # the cover continues under the pages: fill with leather from its visible ring
            hid = (whole & ~cover)[y0:y1, x0:x1]
            ring = cv2.dilate(cm.astype(np.uint8), np.ones((31, 31), np.uint8)).astype(bool) & cm
            med = np.median(crop[ring], axis=0)
            fill = np.clip(med + np.random.RandomState(1).normal(0, 4, (int(hid.sum()), 3)), 0, 255).astype(np.uint8)
            crop[hid] = fill; cm = cm | hid
            soft = cv2.GaussianBlur(crop, (0, 0), 6); zone = cv2.dilate(hid.astype(np.uint8), np.ones((21, 21), np.uint8)).astype(bool) & cm; crop[zone] = soft[zone]
        alpha = cv2.GaussianBlur(cm.astype(np.float32), (0, 0), 0.8)
        # de-fringe: every partly transparent pixel takes the colour of its nearest fully opaque neighbour,
        # so feathered edges never carry the paper colour onto whatever the journal is placed on
        interior = (alpha >= 0.9)
        if interior.any() and (~interior).any():
            dist, labels = cv2.distanceTransformWithLabels((~interior).astype(np.uint8), cv2.DIST_L2, 3, labelType=cv2.DIST_LABEL_PIXEL)
            iy, ix = np.nonzero(interior)
            edge = ~interior
            srcIdx = labels[edge] - 1
            crop = crop.copy(); crop[edge] = crop[iy[srcIdx], ix[srcIdx]]
        rgba = np.dstack([crop, (np.clip(alpha, 0, 1) * 255).astype(np.uint8)])
    cv2.imwrite(os.path.join(out, name + '.png'), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
    parts.append({'name': name, 'z': z, 'bbox': [int(x0), int(y0), int(x1 - x0), int(y1 - y0)], 'blend': 'multiply' if name == 'shadow' else 'normal'}),
    print(f'{name:10s} bbox={x0},{y0},{x1-x0}x{y1-y0}')
json.dump({'source': os.path.basename(src), 'W': W, 'H': H, 'parts': parts}, open(os.path.join(out, 'parts.json'), 'w'), indent=1)

# review: masks overlay + exploded view
ov = img.copy(); rng = np.random.RandomState(2)
for name, m in PARTS[1:]:
    c = rng.randint(60, 255, 3); ov[m] = (ov[m] * 0.5 + c * 0.5).astype(np.uint8)
    cnts, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE); cv2.drawContours(ov, cnts, -1, tuple(int(v) for v in c), 2)
    ys, xs = np.nonzero(m); cv2.putText(ov, name, (int(xs.mean()) - 40, int(ys.mean())), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 4); cv2.putText(ov, name, (int(xs.mean()) - 40, int(ys.mean())), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 1)
cv2.imwrite(os.path.join(out, 'masks-overlay.png'), cv2.cvtColor(ov, cv2.COLOR_RGB2BGR))
ex = np.full((H, W * 2, 3), 242, np.uint8)
for i, p in enumerate(parts):
    rgba = cv2.cvtColor(cv2.imread(os.path.join(out, p['name'] + '.png'), cv2.IMREAD_UNCHANGED), cv2.COLOR_BGRA2RGBA)
    x, y, w, h = p['bbox']; a = rgba[:, :, 3:4] / 255.0
    # exploded: each part shifted down-right by its z
    dx, dy = W // 2 + 60 * i, 60 * i - 150
    X0, Y0 = x + dx, y + dy; X1, Y1 = min(W * 2, X0 + w), min(H, Y0 + h); Y0c, X0c = max(0, Y0), max(0, X0)
    sub = rgba[Y0c - Y0:Y1 - Y0, X0c - X0:X1 - X0]; asub = sub[:, :, 3:4] / 255.0
    ex[Y0c:Y1, X0c:X1] = (sub[:, :, :3] * asub + ex[Y0c:Y1, X0c:X1] * (1 - asub)).astype(np.uint8)
    cv2.putText(ex, p['name'], (X0c + 10, max(20, Y0c + 24)), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (30, 30, 30), 2)
# and the reassembly on the left half
asm = np.full((H, W, 3), 242, np.uint8)
for p in parts:
    rgba = cv2.cvtColor(cv2.imread(os.path.join(out, p['name'] + '.png'), cv2.IMREAD_UNCHANGED), cv2.COLOR_BGRA2RGBA); x, y, w, h = p['bbox']; a = rgba[:, :, 3:4] / 255.0
    asm[y:y + h, x:x + w] = (rgba[:, :, :3] * a + asm[y:y + h, x:x + w] * (1 - a)).astype(np.uint8)
ex[:, :W] = asm
cv2.imwrite(os.path.join(out, 'exploded.png'), cv2.cvtColor(ex, cv2.COLOR_RGB2BGR)); print('parts.json', len(parts))
