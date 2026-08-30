"""Render a sequencer JSON over the notebook layers → frames, GIF, strip. usage: render-seq.py <seq.json> <parts2Dir> <itemsDir> <outDir>"""
import sys, os, json, math, numpy as np, cv2
from PIL import Image
seqf, parts, items, out = sys.argv[1:5]
os.makedirs(out, exist_ok=True)
J = json.load(open(seqf)); W, H = J['W'], J['H']
meta = json.load(open(os.path.join(parts, 'parts.json'))); K = W / meta['W']
def load_rgba(p): return cv2.cvtColor(cv2.imread(p, cv2.IMREAD_UNCHANGED), cv2.COLOR_BGRA2RGBA)
def over(dst, src, x0, y0):
    """alpha-composite src (RGBA) onto dst (RGB) with its top-left at (x0, y0), clipped."""
    h, w = src.shape[:2]; X0, Y0 = int(round(x0)), int(round(y0)); X1, Y1 = X0 + w, Y0 + h
    cx0, cy0, cx1, cy1 = max(0, X0), max(0, Y0), min(dst.shape[1], X1), min(dst.shape[0], Y1)
    if cx1 <= cx0 or cy1 <= cy0: return
    s = src[cy0 - Y0:cy1 - Y0, cx0 - X0:cx1 - X0].astype(np.float32); a = s[:, :, 3:4] / 255.0
    dst[cy0:cy1, cx0:cx1] = (s[:, :, :3] * a + dst[cy0:cy1, cx0:cx1].astype(np.float32) * (1 - a)).astype(np.uint8)
# notebook base
base = np.full((H, W, 3), 242, np.uint8)
for p in sorted(meta['parts'], key=lambda p: p['z']):
    im = load_rgba(os.path.join(parts, p['name'] + '.png')); x, y, w, h = p['bbox']
    im = cv2.resize(im, (max(1, round(w * K)), max(1, round(h * K))), interpolation=cv2.INTER_AREA)
    over(base, im, x * K, y * K)
cv2.imwrite(os.path.join(out, 'notebook.png'), cv2.cvtColor(base, cv2.COLOR_RGB2BGR))
def place(frame, inst):
    im = load_rgba(os.path.join(items, inst['item'] + '.png'))
    s = inst['s']; im = cv2.resize(im, (max(1, round(im.shape[1] * s)), max(1, round(im.shape[0] * s))), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR)
    if inst.get('mx'): im = im[:, ::-1]
    if inst.get('my'): im = im[::-1, :]
    if inst.get('o', 1) < 1: im = im.copy(); im[:, :, 3] = (im[:, :, 3] * inst['o']).astype(np.uint8)
    r = inst.get('r', 0)
    if r:  # CSS rotate(r) is clockwise on screen; OpenCV's positive angle is counter-clockwise
        h, w = im.shape[:2]; c = math.cos(math.radians(r)); sn = math.sin(math.radians(r))
        nw, nh = int(abs(w * c) + abs(h * sn)) + 2, int(abs(w * sn) + abs(h * c)) + 2
        M = cv2.getRotationMatrix2D((w / 2, h / 2), -r, 1.0); M[0, 2] += nw / 2 - w / 2; M[1, 2] += nh / 2 - h / 2
        im = cv2.warpAffine(im, M, (nw, nh), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))
    over(frame, im, inst['x'] - im.shape[1] / 2, inst['y'] - im.shape[0] / 2)
for q in J['sequences']:
    slug = ''.join(ch if ch.isalnum() else '-' for ch in q['name'].lower()).strip('-')
    frames, durs = [], []
    for i, st in enumerate(q['steps']):
        f = base.copy()
        for inst in sorted(st['items'], key=lambda i: i.get('z', 0)): place(f, inst)
        cv2.imwrite(os.path.join(out, f'{slug}-{i + 1:02d}.png'), cv2.cvtColor(f, cv2.COLOR_RGB2BGR)); frames.append(f); durs.append(st['dur'])
    T = 300; sh = int(T * H / W)
    strip = np.full((sh + 24, T * len(frames), 3), 255, np.uint8)
    for i, f in enumerate(frames):
        strip[24:, i * T:(i + 1) * T] = cv2.resize(f, (T, sh), interpolation=cv2.INTER_AREA)
        cv2.putText(strip, f'{i + 1}  {durs[i]}ms', (i * T + 6, 17), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (40, 40, 40), 1)
    cv2.imwrite(os.path.join(out, f'{slug}-strip.png'), cv2.cvtColor(strip, cv2.COLOR_RGB2BGR))
    g = [Image.fromarray(cv2.resize(f, (W // 2, H // 2), interpolation=cv2.INTER_AREA)) for f in frames]
    g[0].save(os.path.join(out, f'{slug}.gif'), save_all=True, append_images=g[1:], duration=durs, loop=0, optimize=True)
    print(q['name'], len(frames), 'frames ->', f'{slug}.gif', os.path.getsize(os.path.join(out, f"{slug}.gif")) // 1024, 'KB')
