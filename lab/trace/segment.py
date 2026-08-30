"""Automatic segmentation of the journal photo with Segment Anything (ViT-B).
Writes masks.npz (bool masks), masks.json (metadata) and two review images:
overlay.png (all candidate masks outlined + numbered) and grid.png (thumbnails)."""
import sys, json, os, numpy as np, cv2, torch
from segment_anything import sam_model_registry, SamAutomaticMaskGenerator
src, out, ckpt = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
img = cv2.cvtColor(cv2.imread(src), cv2.COLOR_BGR2RGB)
H, W = img.shape[:2]
dev = 'cpu'  # SAM's mask generator uses float64 points, which Metal cannot do
sam = sam_model_registry['vit_b'](checkpoint=ckpt).to(dev)
gen = SamAutomaticMaskGenerator(sam, points_per_side=32, pred_iou_thresh=0.86, stability_score_thresh=0.9,
                                crop_n_layers=0, min_mask_region_area=600, box_nms_thresh=0.6)
masks = gen.generate(img)
masks.sort(key=lambda m: -m['area'])
keep = [m for m in masks if 0.0015 * H * W < m['area'] < 0.45 * H * W]
np.savez_compressed(os.path.join(out, 'masks.npz'), *[m['segmentation'] for m in keep])
meta = [{'i': i, 'bbox': [int(v) for v in m['bbox']], 'area': int(m['area']), 'iou': round(float(m['predicted_iou']), 3),
         'stab': round(float(m['stability_score']), 3)} for i, m in enumerate(keep)]
json.dump(meta, open(os.path.join(out, 'masks.json'), 'w'), indent=0)
rng = np.random.RandomState(3)
ov = img.copy()
for i, m in enumerate(keep):
    seg = m['segmentation'].astype(np.uint8)
    color = tuple(int(c) for c in rng.randint(40, 255, 3))
    cnts, _ = cv2.findContours(seg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(ov, cnts, -1, color, 3)
    ys, xs = np.nonzero(seg); cx, cy = int(xs.mean()), int(ys.mean())
    cv2.rectangle(ov, (cx - 18, cy - 16), (cx + 22, cy + 8), (0, 0, 0), -1)
    cv2.putText(ov, str(i), (cx - 14, cy + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
cv2.imwrite(os.path.join(out, 'overlay.png'), cv2.cvtColor(ov, cv2.COLOR_RGB2BGR))
T, cols = 220, 8
rows = (len(keep) + cols - 1) // cols
grid = np.full((rows * (T + 24), cols * T, 3), 255, np.uint8)
for i, m in enumerate(keep):
    x, y, w, h = m['bbox']
    crop = img[y:y + h, x:x + w].copy()
    seg = m['segmentation'][y:y + h, x:x + w]
    crop[~seg] = (crop[~seg] * 0.25 + 190).astype(np.uint8)
    s = min(T / max(w, 1), T / max(h, 1)); tw, th = max(1, int(w * s)), max(1, int(h * s))
    thumb = cv2.resize(crop, (tw, th))
    r, c = divmod(i, cols)
    grid[r * (T + 24):r * (T + 24) + th, c * T:c * T + tw] = thumb
    cv2.putText(grid, f'{i} a={m["area"]//1000}k', (c * T + 4, r * (T + 24) + T + 16), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 1)
cv2.imwrite(os.path.join(out, 'grid.png'), cv2.cvtColor(grid, cv2.COLOR_RGB2BGR))
print(f'{len(masks)} masks, kept {len(keep)}; image {W}x{H}; device {dev}')
