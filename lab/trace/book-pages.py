"""Segment the two pages of the big journal photo with SAM, for the Boids Lab's book mode.
usage: book-pages.py <ckpt> <book.png> <outdir>
writes pages.png (0 = none, 128 = left page, 255 = right page), pages-overlay.png (review), book.jpg (embeddable photo), book.json"""
import sys, json, numpy as np, cv2, torch
from segment_anything import sam_model_registry, SamPredictor
ckpt, src, outdir = sys.argv[1:4]
raw = cv2.imread(src, cv2.IMREAD_UNCHANGED)
if raw.shape[2] == 4: bgra = raw; bgr = raw[:, :, :3].copy(); alpha = raw[:, :, 3]
else: bgr = raw; alpha = np.full(raw.shape[:2], 255, np.uint8); bgra = np.dstack([bgr, alpha])
img = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB); H, W = img.shape[:2]
L = cv2.cvtColor(img, cv2.COLOR_RGB2LAB)[:, :, 0]
sam = sam_model_registry['vit_b'](checkpoint=ckpt).to('cpu'); pred = SamPredictor(sam); pred.set_image(img)

def page(box, pos, neg):
    masks, scores, _ = pred.predict(point_coords=np.array(pos + neg, np.float32), point_labels=np.array([1] * len(pos) + [0] * len(neg), np.int32),
                                    box=np.array(box, np.float32), multimask_output=True)
    # prefer the candidate that fills the box best while staying bright (paper)
    best, bestScore = None, -1
    for m in masks:
        m = m.astype(np.uint8); area = m.sum(); bright = (m & (L > 130)).sum() / max(1, area)
        s = area * bright
        if s > bestScore: best, bestScore = m, s
    m = best & (L > 120).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8); m = (lab == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
    # a page is convex (rounded corners included): the hull removes the notches SAM leaves along the page-stack edge
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE); c = cv2.convexHull(max(cnts, key=cv2.contourArea))
    filled = np.zeros_like(m); cv2.drawContours(filled, [c], -1, 1, -1)
    return filled

spineNeg = [[778, 120], [778, 300], [778, 520], [778, 700]]
left = page([148, 14, 775, 795], [[460, 400], [300, 140], [640, 660], [250, 650], [640, 120]], spineNeg + [[60, 500], [120, 400], [710, 860], [1000, 400]])
right = page([780, 12, 1388, 790], [[1080, 400], [900, 140], [1300, 660], [900, 660], [1300, 130]], spineNeg + [[1470, 500], [1425, 400], [1420, 700], [710, 860], [450, 400]])
right[left > 0] = 0
# neither page crosses the spine line (the closing above can creep into the gutter)
midRow = H // 2; rl = np.nonzero(left[midRow])[0]; rr = np.nonzero(right[midRow])[0]
if len(rl) and len(rr):
    sx = int((rl.max() + rr.min()) / 2); left[:, sx:] = 0; right[:, :sx] = 0
pages = np.zeros((H, W), np.uint8); pages[left > 0] = 128; pages[right > 0] = 255
cv2.imwrite(f'{outdir}/pages.png', pages)
ov = bgr.copy(); ov[left > 0] = (ov[left > 0] * 0.55 + np.array([60, 200, 60]) * 0.45).astype(np.uint8); ov[right > 0] = (ov[right > 0] * 0.55 + np.array([200, 120, 40]) * 0.45).astype(np.uint8)
cv2.imwrite(f'{outdir}/pages-overlay.png', ov)
cv2.imwrite(f'{outdir}/book.webp', bgra, [cv2.IMWRITE_WEBP_QUALITY, 88])   # the photo keeps its cut-out alpha
def bbox(m):
    ys, xs = np.nonzero(m); return [int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)]
bl, br = bbox(left), bbox(right)
mid = H // 2; rowL = np.nonzero(left[mid])[0]; rowR = np.nonzero(right[mid])[0]
spine = int((rowL.max() + rowR.min()) / 2) if len(rowL) and len(rowR) else (bl[2] + br[0]) // 2
border = np.concatenate([bgr[:6].reshape(-1, 3), bgr[-6:].reshape(-1, 3), bgr[:, :6].reshape(-1, 3), bgr[:, -6:].reshape(-1, 3)]).mean(0)
hexc = lambda c: '#%02x%02x%02x' % (int(c[2]), int(c[1]), int(c[0]))
top = bgr[:6].reshape(-1, 3).mean(0); bottom = bgr[-6:].reshape(-1, 3).mean(0)
info = {'W': W, 'H': H, 'left': bl, 'right': br, 'spine': spine, 'gap': int(rowR.min() - rowL.max()) if len(rowL) and len(rowR) else 0,
        'surround': hexc(border), 'surroundTop': hexc(top), 'surroundBottom': hexc(bottom), 'alpha': bool(raw.shape[2] == 4 and int((alpha == 0).sum()) > 0)}
json.dump(info, open(f'{outdir}/book.json', 'w'), indent=1); print(json.dumps(info))
