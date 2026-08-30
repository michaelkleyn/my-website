"""Embed the journal parts (downscaled) into builder-template.html → lab/journal-builder.html"""
import json, base64, os, sys, cv2
S = os.path.dirname(os.path.abspath(__file__))
PARTS = os.path.join(S, 'parts2'); OUT = '/Users/michaelkleyn/Projects/Repos/my-website/.claude/worktrees/fish-school/lab/journal-builder.html'
meta = json.load(open(os.path.join(PARTS, 'parts.json')))
K = 0.75  # downscale everything the same amount
def b64png(im): ok, buf = cv2.imencode('.png', im, [cv2.IMWRITE_PNG_COMPRESSION, 9]); return 'data:image/png;base64,' + base64.b64encode(buf).decode()
def b64jpg(im): ok, buf = cv2.imencode('.jpg', im, [cv2.IMWRITE_JPEG_QUALITY, 72]); return 'data:image/jpeg;base64,' + base64.b64encode(buf).decode()
parts = []
total = 0
for p in meta['parts']:
    im = cv2.imread(os.path.join(PARTS, p['name'] + '.png'), cv2.IMREAD_UNCHANGED)
    im = cv2.resize(im, (max(1, int(im.shape[1] * K)), max(1, int(im.shape[0] * K))), interpolation=cv2.INTER_AREA)
    png = b64png(im); total += len(png)
    x, y, w, h = p['bbox']
    parts.append({'name': p['name'], 'z': p['z'], 'blend': p.get('blend', 'normal'), 'bbox': [round(x * K), round(y * K), round(w * K), round(h * K)], 'png': png, 'locked': p['name'] in ('shadow', 'cover', 'block', 'stitches')})
src = cv2.imread(os.path.join(S, 'journal2.png')); src = cv2.resize(src, (int(src.shape[1] * K), int(src.shape[0] * K)), interpolation=cv2.INTER_AREA)
data = {'W': round(meta['W'] * K), 'H': round(meta['H'] * K), 'source': b64jpg(src), 'parts': parts}
html = open(os.path.join(S, 'builder-template.html')).read().replace('__PARTS__', json.dumps(data))
open(OUT, 'w').write(html)
print('wrote', OUT, len(html) // 1024, 'KB (parts', total // 1024, 'KB)')
