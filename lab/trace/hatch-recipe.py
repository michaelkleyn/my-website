"""Tonal crosshatch recipe for a cut-out (RGBA): outline, luminance bands as polygons (each band gets its own hatch
angle/spacing), crack/edge lines. usage: hatch-recipe.py <in.png> <out.json> [bands]"""
import sys, json, numpy as np, cv2
src, out = sys.argv[1], sys.argv[2]; NB = int(sys.argv[3]) if len(sys.argv) > 3 else 4
ATHR = int(sys.argv[4]) if len(sys.argv) > 4 else 128          # alpha threshold for the tonal region (low = include soft shadows)
OUTLINE_SRC = sys.argv[5] if len(sys.argv) > 5 else None     # optional mask image whose silhouette gives the outline / paper body
im = cv2.imread(src, cv2.IMREAD_UNCHANGED); H, W = im.shape[:2]
alpha = im[:, :, 3] > ATHR
# composite over white so a translucent shadow becomes a grey tone
a255 = im[:, :, 3:4].astype(np.float32) / 255.0
bgr = (im[:, :, :3].astype(np.float32) * a255 + 255 * (1 - a255)).astype(np.uint8); bgr[~alpha] = 255
sm = cv2.pyrMeanShiftFiltering(bgr, 9, 22)
L = cv2.cvtColor(sm, cv2.COLOR_BGR2LAB)[:, :, 0].astype(np.float32)
L[~alpha] = 255
def polys(mask, eps, min_area):
    cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE); res = []
    for c in cnts:
        if cv2.contourArea(c) < min_area: continue
        ap = cv2.approxPolyDP(c, eps, True)
        if len(ap) >= 3: res.append([[round(float(p[0][0]), 1), round(float(p[0][1]), 1)] for p in ap])
    return res
# outline: smoothed silhouette
omask = alpha if not OUTLINE_SRC else (cv2.imread(OUTLINE_SRC, cv2.IMREAD_UNCHANGED)[:, :, 3] > 128)
cnts, _ = cv2.findContours(omask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
c = max(cnts, key=cv2.contourArea).reshape(-1, 2).astype(np.float32)
k = 9; pad = np.concatenate([c[-k:], c, c[:k]]); ker = np.ones(k) / k
smooth = np.stack([np.convolve(pad[:, 0], ker, 'same')[k:-k], np.convolve(pad[:, 1], ker, 'same')[k:-k]], 1)
ap = cv2.approxPolyDP(smooth.reshape(-1, 1, 2).astype(np.float32), 2.5, True)
outline = [[round(float(p[0][0]), 1), round(float(p[0][1]), 1)] for p in ap]
# tonal bands: nested darker-than thresholds at luminance percentiles
vals = L[alpha]
pcts = np.linspace(72, 14, NB)
angles = [38, -32, 82, 12, -70][:NB]
dists = [12, 10, 8, 7, 6][:NB]
bands = []
for i, pc in enumerate(pcts):
    t = float(np.percentile(vals, pc))
    m = ((L < t) & alpha).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)); m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    ps = polys(m, 2.2, 160)
    bands.append({'angle': angles[i], 'dist': dists[i], 'level': round(t, 1), 'polys': ps})
# edge lines (cracks): strong edges inside the silhouette
gray = cv2.cvtColor(sm, cv2.COLOR_BGR2GRAY); edges = cv2.Canny(gray, 55, 140)
inner = cv2.erode(alpha.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool); edges[~inner] = 0
gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0); gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1); mag = np.hypot(gx, gy)
cnts, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE); lines = []
for c in cnts:
    Lc = cv2.arcLength(c, False)
    if Lc < 26: continue
    pts = c.reshape(-1, 2); strength = float(np.mean(mag[pts[:, 1], pts[:, 0]]))
    ap = cv2.approxPolyDP(c, 1.6, False)
    if len(ap) >= 2: lines.append((Lc * strength, [[round(float(p[0][0]), 1), round(float(p[0][1]), 1)] for p in ap]))
lines.sort(key=lambda t: -t[0]); lines = [l for _, l in lines[:220]]
json.dump({'w': W, 'h': H, 'outline': outline, 'bands': bands, 'lines': lines}, open(out, 'w'), separators=(',', ':'))
print('outline', len(outline), 'bands', [len(b['polys']) for b in bands], 'lines', len(lines), '->', out)
