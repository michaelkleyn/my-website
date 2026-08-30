"""Cut a single object off a plain (dark or light) background with SAM: usage cutout.py <ckpt> <in> <out.png> [maxWidth]"""
import sys, numpy as np, cv2, torch
from segment_anything import sam_model_registry, SamPredictor
ckpt, src, out = sys.argv[1:4]; maxw = int(sys.argv[4]) if len(sys.argv) > 4 else 0
img = cv2.cvtColor(cv2.imread(src), cv2.COLOR_BGR2RGB); H, W = img.shape[:2]
sam = sam_model_registry['vit_b'](checkpoint=ckpt).to('cpu'); pred = SamPredictor(sam); pred.set_image(img)
L = cv2.cvtColor(img, cv2.COLOR_RGB2LAB)[:, :, 0]
bg = float(np.median(np.concatenate([L[:8].ravel(), L[-8:].ravel(), L[:, :8].ravel(), L[:, -8:].ravel()])))
fg = (np.abs(L.astype(np.int16) - bg) > 18).astype(np.uint8)
fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
n, lab, st, cen = cv2.connectedComponentsWithStats(fg, 8)
bi = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA])); blob = (lab == bi).astype(np.uint8)
dt = cv2.distanceTransform(blob, cv2.DIST_L2, 5); pos = []
for _ in range(4):
    yy, xx = np.unravel_index(int(np.argmax(dt)), dt.shape); pos.append([int(xx), int(yy)]); cv2.circle(dt, (int(xx), int(yy)), int(min(W, H) * 0.18), 0, -1)
neg = [[8, 8], [W - 8, 8], [8, H - 8], [W - 8, H - 8]]
x, y, w, h = st[bi, cv2.CC_STAT_LEFT], st[bi, cv2.CC_STAT_TOP], st[bi, cv2.CC_STAT_WIDTH], st[bi, cv2.CC_STAT_HEIGHT]
box = np.array([max(0, x - 6), max(0, y - 6), min(W, x + w + 6), min(H, y + h + 6)], np.float32)
masks, scores, _ = pred.predict(point_coords=np.array(pos + neg, np.float32), point_labels=np.array([1] * len(pos) + [0] * 4, np.int32), box=box, multimask_output=True)
m = masks[int(np.argmax([mm.sum() for mm in masks]))].astype(np.uint8)
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE); c = max(cnts, key=cv2.contourArea); m = np.zeros_like(m); cv2.drawContours(m, [c], -1, 1, -1)
m &= (np.abs(L.astype(np.int16) - bg) > 14).astype(np.uint8)  # never keep background-coloured pixels (concave notches)
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
n2, lab2, st2, _ = cv2.connectedComponentsWithStats(m, 8); m = (lab2 == 1 + int(np.argmax(st2[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
ys, xs = np.nonzero(m); x0, x1, y0, y1 = max(0, xs.min() - 2), min(W, xs.max() + 3), max(0, ys.min() - 2), min(H, ys.max() + 3)
crop = img[y0:y1, x0:x1]; a = cv2.GaussianBlur(m[y0:y1, x0:x1].astype(np.float32), (0, 0), 0.9)
# un-fringe: pull edge pixels away from the background colour
rgba = np.dstack([crop, (np.clip(a, 0, 1) * 255).astype(np.uint8)])
if maxw and rgba.shape[1] > maxw: rgba = cv2.resize(rgba, (maxw, int(rgba.shape[0] * maxw / rgba.shape[1])), interpolation=cv2.INTER_AREA)
cv2.imwrite(out, cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA)); print(out, rgba.shape[1], 'x', rgba.shape[0], 'bg L', round(bg))
