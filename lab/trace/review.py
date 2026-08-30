"""Contact sheet: for each object, source cutout | painted sprite, same scale. usage: review.py <cropsDir> <spritesDir> <out.png> [names...]"""
import sys, os, cv2, numpy as np
crops, sprites, out = sys.argv[1:4]
names = sys.argv[4:] or sorted(n[:-4] for n in os.listdir(sprites) if n.endswith('.png'))
def load_rgba(p):
    im = cv2.imread(p, cv2.IMREAD_UNCHANGED)
    if im is None: return None
    if im.shape[2] == 3: im = cv2.cvtColor(im, cv2.COLOR_BGR2BGRA)
    return im
def over_paper(im, paper=(244, 244, 244)):
    a = im[:, :, 3:4] / 255.0
    bg = np.full(im.shape[:2] + (3,), paper, np.uint8)
    return (im[:, :, :3] * a + bg * (1 - a)).astype(np.uint8)
TH = 260
rows = []
for n in names:
    a = load_rgba(os.path.join(crops, n + '.png')); b = load_rgba(os.path.join(sprites, n + '.png'))
    if a is None or b is None: continue
    tiles = []
    for im in (a, b):
        rgb = over_paper(im); h, w = rgb.shape[:2]; s = min(TH / h, 520 / w)
        tiles.append(cv2.resize(rgb, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_AREA))
    row = np.full((TH + 30, 1080, 3), 244, np.uint8)
    row[30:30 + tiles[0].shape[0], 10:10 + tiles[0].shape[1]] = tiles[0]
    row[30:30 + tiles[1].shape[0], 550:550 + tiles[1].shape[1]] = tiles[1]
    cv2.putText(row, n, (10, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (30, 30, 30), 2)
    cv2.putText(row, 'painted', (550, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (90, 90, 90), 1)
    rows.append(row)
sheet = np.vstack(rows) if rows else np.zeros((10, 10, 3), np.uint8)
cv2.imwrite(out, sheet); print('wrote', out, sheet.shape, len(rows), 'rows')
