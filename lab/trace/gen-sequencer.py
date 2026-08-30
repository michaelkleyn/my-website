"""Embed notebook layers (parts2, ×0.75) + the 24 page-turn cutouts into sequencer-template.html → lab/page-turn-sequencer.html"""
import json, base64, os, cv2
S = os.path.dirname(os.path.abspath(__file__))
OUT = '/Users/michaelkleyn/Projects/Repos/my-website/.claude/worktrees/fish-school/lab/page-turn-sequencer.html'
K = 0.75
def enc(im, prefer_webp=True):
    if prefer_webp:
        ok, buf = cv2.imencode('.webp', im, [cv2.IMWRITE_WEBP_QUALITY, 88])
        if ok and len(buf) > 0: return 'data:image/webp;base64,' + base64.b64encode(buf).decode()
    ok, buf = cv2.imencode('.png', im, [cv2.IMWRITE_PNG_COMPRESSION, 9]); return 'data:image/png;base64,' + base64.b64encode(buf).decode()
meta = json.load(open(os.path.join(S, 'parts2', 'parts.json')))
notebook = []
for p in meta['parts']:
    im = cv2.imread(os.path.join(S, 'parts2', p['name'] + '.png'), cv2.IMREAD_UNCHANGED)
    im = cv2.resize(im, (max(1, int(im.shape[1] * K)), max(1, int(im.shape[0] * K))), interpolation=cv2.INTER_AREA)
    x, y, w, h = p['bbox']; notebook.append({'name': p['name'], 'z': p['z'], 'blend': p.get('blend', 'normal'), 'bbox': [round(x * K), round(y * K), round(w * K), round(h * K)], 'src': enc(im)})
items = []
for it in json.load(open(os.path.join(S, 'turns', 'items.json')))['items']:
    im = cv2.imread(os.path.join(S, 'turns', 'items', it['name'] + '.png'), cv2.IMREAD_UNCHANGED)
    items.append({'name': it['name'], 'w': im.shape[1], 'h': im.shape[0], 'src': enc(im)})
# default drop anchor: centre of the right page in notebook space
pr = [p for p in meta['parts'] if p['name'] == 'page-right'][0]['bbox']
data = {'W': round(meta['W'] * K), 'H': round(meta['H'] * K), 'anchor': {'x': round((pr[0] + pr[2] / 2) * K), 'y': round((pr[1] + pr[3] / 2) * K)}, 'notebook': notebook, 'items': items}
html = open(os.path.join(S, 'sequencer-template.html')).read().replace('__DATA__', json.dumps(data))
open(OUT, 'w').write(html); print('wrote', OUT, len(html) // 1024, 'KB; notebook', sum(len(p['src']) for p in notebook) // 1024, 'KB; items', sum(len(i['src']) for i in items) // 1024, 'KB')
