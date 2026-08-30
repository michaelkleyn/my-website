"""Cut page-turn sprite sheets (3×2 grid on a dark ground) into RGBA items with SAM box prompts.
usage: turns.py <ckpt> <outDir> <sheet1.png> [sheet2.png ...]  → outDir/items/sN-M.png, items.json, contact.png"""
import sys, os, json, numpy as np, cv2, torch
from segment_anything import sam_model_registry, SamPredictor
ckpt, out = sys.argv[1], sys.argv[2]; sheets = sys.argv[3:]
os.makedirs(os.path.join(out, 'items'), exist_ok=True)
sam = sam_model_registry['vit_b'](checkpoint=ckpt).to('cpu'); pred = SamPredictor(sam)
COLS, ROWS = 3, 2
items = []; tiles = []
for si, path in enumerate(sheets, 1):
    img = cv2.cvtColor(cv2.imread(path), cv2.COLOR_BGR2RGB); H, W = img.shape[:2]
    L = cv2.cvtColor(img, cv2.COLOR_RGB2LAB)[:, :, 0]
    pred.set_image(img)
    cw, ch = W / COLS, H / ROWS
    for r in range(ROWS):
        for c in range(COLS):
            n = r * COLS + c + 1
            x0c, y0c, x1c, y1c = int(c * cw), int(r * ch), int((c + 1) * cw), int((r + 1) * ch)
            box = np.array([x0c + 4, y0c + 4, x1c - 4, y1c - 4], np.float32)
            # positive points: the brightest paper blob in the cell; negatives: the cell's corners and edge midpoints (always ground)
            Lc = L[y0c:y1c, x0c:x1c]
            bright = cv2.morphologyEx((Lc > 175).astype(np.uint8), cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
            nl, lb, st, cen = cv2.connectedComponentsWithStats(bright, 8)
            pos = []
            if nl > 1:
                bi = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA])); blob = (lb == bi).astype(np.uint8)
                dt = cv2.distanceTransform(blob, cv2.DIST_L2, 5)
                for _ in range(3):
                    yy, xx = np.unravel_index(int(np.argmax(dt)), dt.shape); pos.append([x0c + int(xx), y0c + int(yy)])
                    cv2.circle(dt, (int(xx), int(yy)), 60, 0, -1)
            ins = 10
            neg = [[x0c + ins, y0c + ins], [x1c - ins, y0c + ins], [x0c + ins, y1c - ins], [x1c - ins, y1c - ins],
                   [(x0c + x1c) // 2, y0c + ins], [(x0c + x1c) // 2, y1c - ins], [x0c + ins, (y0c + y1c) // 2], [x1c - ins, (y0c + y1c) // 2]]
            pts = np.array(pos + neg, np.float32); lbl = np.array([1] * len(pos) + [0] * len(neg), np.int32)
            masks, scores, _ = pred.predict(point_coords=pts, point_labels=lbl, box=box, multimask_output=True)
            cands = [(scores[i], i) for i, m in enumerate(masks) if m.sum() < 0.6 * cw * ch and m.sum() > 0.01 * cw * ch]
            mi = max(cands)[1] if cands else int(np.argmax(scores))
            mp = masks[mi] & (L > 45)
            # a plain box prompt sees the whole page (light face + dark back); keep it only when it is paper-like, not ground
            mb_all, _, _ = pred.predict(box=box, multimask_output=True)
            mb = None
            for cand in sorted(mb_all, key=lambda x: -x.sum()):
                if 0.01 * cw * ch < cand.sum() < 0.6 * cw * ch and float(L[cand].mean()) > 110 and (cand & mp).sum() > 0.5 * mp.sum():
                    mb = cand; break
            m = (mp | (mb & (L > 95)) if mb is not None else mp).astype(np.uint8)  # box mask adds the page's dark back, never the ground
            m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8)); m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
            nlab, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
            if nlab > 1:
                areas = stats[1:, cv2.CC_STAT_AREA]; keep = [i + 1 for i, a in enumerate(areas) if a >= 0.12 * areas.max()]
                m = np.isin(lab, keep).astype(np.uint8)
            cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE); filled = np.zeros_like(m); cv2.drawContours(filled, cnts, -1, 1, -1); m = filled
            ys, xs = np.nonzero(m)
            if len(xs) == 0: print('EMPTY', si, n); continue
            x0, x1, y0, y1 = max(0, xs.min() - 2), min(W, xs.max() + 3), max(0, ys.min() - 2), min(H, ys.max() + 3)
            crop = img[y0:y1, x0:x1]; cm = m[y0:y1, x0:x1].astype(np.float32)
            alpha = cv2.GaussianBlur(cm, (0, 0), 0.9)
            rgba = np.dstack([crop, (np.clip(alpha, 0, 1) * 255).astype(np.uint8)])
            name = f's{si}-{n}'
            cv2.imwrite(os.path.join(out, 'items', name + '.png'), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
            items.append({'name': name, 'sheet': si, 'cell': n, 'w': int(x1 - x0), 'h': int(y1 - y0), 'area': int(m.sum())})
            tiles.append((name, rgba))
            print(f'{name} {x1-x0}x{y1-y0} area={int(m.sum())//1000}k')
json.dump({'items': items}, open(os.path.join(out, 'items.json'), 'w'), indent=1)
# contact sheet on a mid-grey ground (so the light paper and any leftover glow both show)
T = 240; cols = 6; rows = (len(tiles) + cols - 1) // cols
sheet = np.full((rows * (T + 26), cols * T, 3), 150, np.uint8)
for i, (name, rgba) in enumerate(tiles):
    h, w = rgba.shape[:2]; s = min(T / w, T / h); tw, th = max(1, int(w * s)), max(1, int(h * s))
    t = cv2.resize(rgba, (tw, th), interpolation=cv2.INTER_AREA); a = t[:, :, 3:4] / 255.0
    r, c = divmod(i, cols); y0, x0 = r * (T + 26), c * T
    sheet[y0:y0 + th, x0:x0 + tw] = (t[:, :, :3] * a + sheet[y0:y0 + th, x0:x0 + tw] * (1 - a)).astype(np.uint8)
    cv2.putText(sheet, name, (x0 + 6, y0 + T + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
cv2.imwrite(os.path.join(out, 'contact.png'), cv2.cvtColor(sheet, cv2.COLOR_RGB2BGR)); print('items', len(items))
