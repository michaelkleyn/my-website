"""Build the compiled journal data (notebook layers, page poses used by the sequences, props, sequences) and
(1) write lab/turn-player.html, (2) inject it into lab/boids-lab.html between the journal-data markers."""
import json, base64, os, re, cv2
S = os.path.dirname(os.path.abspath(__file__))
W = '/Users/michaelkleyn/Projects/Repos/my-website/.claude/worktrees/fish-school/lab'
def enc(im):
    ok, buf = cv2.imencode('.webp', im, [cv2.IMWRITE_WEBP_QUALITY, 88])
    if ok and len(buf): return 'data:image/webp;base64,' + base64.b64encode(buf).decode()
    ok, buf = cv2.imencode('.png', im); return 'data:image/png;base64,' + base64.b64encode(buf).decode()
def build(seqfiles):
    seqs = []; Wn = Hn = None
    for f in seqfiles:
        J = json.load(open(f)); Wn, Hn = J['W'], J['H']; seqs += J['sequences']
    meta = json.load(open(os.path.join(S, 'parts2', 'parts.json'))); K = Wn / meta['W']
    notebook = []
    for p in meta['parts']:
        im = cv2.imread(os.path.join(S, 'parts2', p['name'] + '.png'), cv2.IMREAD_UNCHANGED)
        im = cv2.resize(im, (max(1, round(im.shape[1] * K)), max(1, round(im.shape[0] * K))), interpolation=cv2.INTER_AREA)
        x, y, w, h = p['bbox']; notebook.append({'name': p['name'], 'z': p['z'], 'blend': p.get('blend', 'normal'), 'bbox': [round(x * K), round(y * K), round(w * K), round(h * K)], 'src': enc(im)})
    used = sorted({i['item'] for q in seqs for st in q['steps'] for i in st['items']})
    items = {}
    for name in used:
        im = cv2.imread(os.path.join(S, 'turns', 'items', name + '.png'), cv2.IMREAD_UNCHANGED); items[name] = {'w': im.shape[1], 'h': im.shape[0], 'src': enc(im)}
        hf = os.path.join(S, 'turns', 'items', name + '.hatch.json')
        if os.path.exists(hf): items[name]['hatch'] = json.load(open(hf))
    props = []
    for q in json.load(open(os.path.join(S, 'props', 'props.json'))):
        im = cv2.imread(os.path.join(S, 'props', q['name'] + '.png'), cv2.IMREAD_UNCHANGED)
        entry = dict(q, w=im.shape[1], h=im.shape[0], src=enc(im))
        hf = os.path.join(S, 'props', q['name'] + '.hatch.json')
        if os.path.exists(hf): entry['hatch'] = json.load(open(hf))   # crosshatch drawing recipe (painted in the browser)
        props.append(entry)
    jh = None
    jf = os.path.join(S, 'props', 'journal-flat.png')
    if os.path.exists(jf) and os.path.exists(jf.replace('.png', '.hatch.json')):
        im = cv2.imread(jf, cv2.IMREAD_UNCHANGED)
        jh = {'w': im.shape[1], 'h': im.shape[0], 'src': enc(im), 'recipe': json.load(open(jf.replace('.png', '.hatch.json')))}
        sf = os.path.join(S, 'props', 'journal-shadow.hatch.json')
        if os.path.exists(sf): jh['shadow'] = json.load(open(sf))
    return {'W': Wn, 'H': Hn, 'notebook': notebook, 'items': items, 'sequences': seqs, 'props': props, 'journalHatch': jh}
if __name__ == '__main__':
    data = build([os.path.join(S, 'seqs', 'turn-1.json')])
    js = json.dumps(data)
    html = open(os.path.join(S, 'player-template.html')).read().replace('__DATA__', js)
    open(os.path.join(W, 'turn-player.html'), 'w').write(html); print('player', len(html) // 1024, 'KB')
    lab = open(os.path.join(W, 'boids-lab.html')).read()
    block = '<script id="journal-data">window.JOURNAL = ' + js + ';</script>'
    if '<script id="journal-data">' in lab:
        lab = re.sub(r'<script id="journal-data">.*?</script>', lambda m: block, lab, count=1, flags=re.S)
    else:
        lab = lab.replace('<script src="https://cdn.jsdelivr.net/npm/p5.brush@2.2.2/dist/brush.js"></script>', block + '\n<script src="https://cdn.jsdelivr.net/npm/p5.brush@2.2.2/dist/brush.js"></script>', 1)
    open(os.path.join(W, 'boids-lab.html'), 'w').write(lab); print('boids lab', len(lab) // 1024, 'KB')
