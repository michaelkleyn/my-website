"""Compile sequence JSON(s) + notebook layers + only the page items they use into a self-contained player. usage: gen-player.py out.html seq1.json [seq2.json …]"""
import sys, json, base64, os, cv2
S = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1]; seqfiles = sys.argv[2:]
def enc(im):
    ok, buf = cv2.imencode('.webp', im, [cv2.IMWRITE_WEBP_QUALITY, 88])
    if ok and len(buf): return 'data:image/webp;base64,' + base64.b64encode(buf).decode()
    ok, buf = cv2.imencode('.png', im); return 'data:image/png;base64,' + base64.b64encode(buf).decode()
seqs = []; W = H = None
for f in seqfiles:
    J = json.load(open(f)); W, H = J['W'], J['H']; seqs += J['sequences']
meta = json.load(open(os.path.join(S, 'parts2', 'parts.json'))); K = W / meta['W']
notebook = []
for p in meta['parts']:
    im = cv2.imread(os.path.join(S, 'parts2', p['name'] + '.png'), cv2.IMREAD_UNCHANGED)
    im = cv2.resize(im, (max(1, round(im.shape[1] * K)), max(1, round(im.shape[0] * K))), interpolation=cv2.INTER_AREA)
    x, y, w, h = p['bbox']; notebook.append({'name': p['name'], 'z': p['z'], 'blend': p.get('blend', 'normal'), 'bbox': [round(x * K), round(y * K), round(w * K), round(h * K)], 'src': enc(im)})
used = sorted({i['item'] for q in seqs for st in q['steps'] for i in st['items']})
items = {}
for name in used:
    im = cv2.imread(os.path.join(S, 'turns', 'items', name + '.png'), cv2.IMREAD_UNCHANGED)
    items[name] = {'w': im.shape[1], 'h': im.shape[0], 'src': enc(im)}
# props: rock buttons flanking the notebook (positions in notebook space, may be outside its box; the frame is padded)
PROPS = [{'name': 'boulder', 'action': None, 'layer': 'under', 'x': 543, 'y': 440, 's': 1.25, 'r': 0},
         {'name': 'rock-left', 'action': 'back', 'x': -60, 'y': 470, 's': 0.28, 'r': -8}, {'name': 'rock-right', 'action': 'forward', 'x': 1130, 'y': 330, 's': 0.28, 'r': 6}]
pf = os.path.join(S, 'props', 'props.json')
if os.path.exists(pf):
    saved = {q['name']: q for q in json.load(open(pf))}
    for q in PROPS: q.update({k: saved[q['name']][k] for k in ('x', 'y', 's', 'r') if q['name'] in saved and k in saved[q['name']]})
props = []
for q in PROPS:
    im = cv2.imread(os.path.join(S, 'props', q['name'] + '.png'), cv2.IMREAD_UNCHANGED)
    props.append(dict(q, w=im.shape[1], h=im.shape[0], src=enc(im)))
data = {'W': W, 'H': H, 'pad': [260, 220], 'notebook': notebook, 'items': items, 'sequences': seqs, 'props': props}
html = open(os.path.join(S, 'player-template.html')).read().replace('__DATA__', json.dumps(data))
open(out, 'w').write(html); print('wrote', out, len(html) // 1024, 'KB; items used:', ', '.join(used))
