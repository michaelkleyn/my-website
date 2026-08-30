"""Build the compiled journal (notebook layers, the page poses the sequences use, props, hatch recipes, sequences)
as FILES for the pond — assets/pond/journal/{journal.json, notebook/*.webp, items/*.webp, props/*.webp, hatch/*.json} —
and write lab/turn-player.html (which keeps the data inline). Needs OpenCV (lab/trace/.venv).
usage: gen-journal.py [--sources <dir with sequences/ parts2/ props/ turns/items/>] [--out <assets/pond/journal>]
The PNG sources are not in git: point --sources at the pond-sources backup (assets/_unshipped/pond-sources)."""
import json, base64, os, sys, shutil, cv2
T = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.dirname(os.path.dirname(T))
def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
S = arg('--sources', os.path.join(T, 'data'))
OUT = arg('--out', os.path.join(REPO, 'assets', 'pond', 'journal'))
LAB = os.path.dirname(T)

def write_img(im, rel):
    """encode as WebP (PNG fallback) into OUT/rel; returns the relative path actually written"""
    path = os.path.join(OUT, rel); os.makedirs(os.path.dirname(path), exist_ok=True)
    ok, buf = cv2.imencode('.webp', im, [cv2.IMWRITE_WEBP_QUALITY, 88])
    if not (ok and len(buf)):
        ok, buf = cv2.imencode('.png', im); rel = os.path.splitext(rel)[0] + '.png'; path = os.path.join(OUT, rel)
    open(path, 'wb').write(buf.tobytes()); return rel
def write_json(obj, rel):
    path = os.path.join(OUT, rel); os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(obj, open(path, 'w'), separators=(',', ':')); return rel

def build(seqfiles):
    seqs = []; Wn = Hn = None
    for f in seqfiles:
        J = json.load(open(f)); Wn, Hn = J['W'], J['H']; seqs += J['sequences']
    meta = json.load(open(os.path.join(S, 'parts2', 'parts.json'))); K = Wn / meta['W']
    notebook = []
    for p in meta['parts']:
        im = cv2.imread(os.path.join(S, 'parts2', p['name'] + '.png'), cv2.IMREAD_UNCHANGED)
        im = cv2.resize(im, (max(1, round(im.shape[1] * K)), max(1, round(im.shape[0] * K))), interpolation=cv2.INTER_AREA)
        x, y, w, h = p['bbox']
        notebook.append({'name': p['name'], 'z': p['z'], 'blend': p.get('blend', 'normal'), 'bbox': [round(x * K), round(y * K), round(w * K), round(h * K)],
                         'src': write_img(im, 'notebook/%s.webp' % p['name'])})
    used = sorted({i['item'] for q in seqs for st in q['steps'] for i in st['items']})
    items = {}
    for name in used:
        im = cv2.imread(os.path.join(S, 'turns', 'items', name + '.png'), cv2.IMREAD_UNCHANGED)
        items[name] = {'w': im.shape[1], 'h': im.shape[0], 'src': write_img(im, 'items/%s.webp' % name)}
        hf = os.path.join(S, 'turns', 'items', name + '.hatch.json')
        if os.path.exists(hf): items[name]['hatch'] = write_json(json.load(open(hf)), 'hatch/%s.json' % name)
    props = []
    for q in json.load(open(os.path.join(S, 'props', 'props.json'))):
        im = cv2.imread(os.path.join(S, 'props', q['name'] + '.png'), cv2.IMREAD_UNCHANGED)
        entry = dict(q, w=im.shape[1], h=im.shape[0], src=write_img(im, 'props/%s.webp' % q['name']))
        hf = os.path.join(S, 'props', q['name'] + '.hatch.json')
        if os.path.exists(hf): entry['hatch'] = write_json(json.load(open(hf)), 'hatch/%s.json' % q['name'])   # crosshatch recipe, painted in the browser
        props.append(entry)
    jh = None
    jf = os.path.join(S, 'props', 'journal-flat.png')
    if os.path.exists(jf) and os.path.exists(jf.replace('.png', '.hatch.json')):
        im = cv2.imread(jf, cv2.IMREAD_UNCHANGED)
        jh = {'w': im.shape[1], 'h': im.shape[0], 'src': write_img(im, 'props/journal-flat.webp'), 'recipe': write_json(json.load(open(jf.replace('.png', '.hatch.json'))), 'hatch/journal-flat.json')}
        sf = os.path.join(S, 'props', 'journal-shadow.hatch.json')
        if os.path.exists(sf): jh['shadow'] = write_json(json.load(open(sf)), 'hatch/journal-shadow.json')
    return {'W': Wn, 'H': Hn, 'notebook': notebook, 'items': items, 'sequences': seqs, 'props': props, 'journalHatch': jh}

def inlined(data):
    """the manifest with files pulled back in as data URLs / objects (what the turn player and single-file builds embed)"""
    import copy; d = copy.deepcopy(data)
    def durl(rel):
        mime = 'image/png' if rel.endswith('.png') else 'image/webp'
        return 'data:%s;base64,%s' % (mime, base64.b64encode(open(os.path.join(OUT, rel), 'rb').read()).decode())
    def jload(rel): return json.load(open(os.path.join(OUT, rel)))
    for l in d['notebook']: l['src'] = durl(l['src'])
    for it in d['items'].values():
        it['src'] = durl(it['src']); it['hatch'] = jload(it['hatch']) if isinstance(it.get('hatch'), str) else it.get('hatch')
        if it.get('hatch') is None: it.pop('hatch', None)
    for p in d['props']:
        p['src'] = durl(p['src'])
        if isinstance(p.get('hatch'), str): p['hatch'] = jload(p['hatch'])
    if d.get('journalHatch'):
        jh = d['journalHatch']; jh['src'] = durl(jh['src']); jh['recipe'] = jload(jh['recipe'])
        if isinstance(jh.get('shadow'), str): jh['shadow'] = jload(jh['shadow'])
    return d

if __name__ == '__main__':
    seqdir = os.path.join(S, 'sequences')
    seqfiles = sorted(os.path.join(seqdir, f) for f in os.listdir(seqdir) if f.endswith('.json'))
    data = build(seqfiles)
    json.dump(data, open(os.path.join(OUT, 'journal.json'), 'w'), indent=1)
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
    print('journal →', OUT, '(%d files, %d KB)' % (sum(len(fs) for _, _, fs in os.walk(OUT)), size // 1024))
    tpl = os.path.join(T, 'player-template.html')
    if os.path.exists(tpl):
        html = open(tpl).read().replace('__DATA__', json.dumps(inlined(data)))
        open(os.path.join(LAB, 'turn-player.html'), 'w').write(html); print('player', len(html) // 1024, 'KB')
