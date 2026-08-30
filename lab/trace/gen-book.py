"""Emit the book assets for the pond: assets/pond/book/{book.json, book.webp, pages.png}.
usage: gen-book.py [--sources <dir with book.json/book.webp/pages.png>] [--out <assets/pond/book>]
(The lab and the site load these through js/pond/assets.js; nothing is injected into HTML any more.)"""
import json, os, shutil, sys
T = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.dirname(os.path.dirname(T))
def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
SRC = arg('--sources', os.path.join(T, 'data', 'book'))
OUT = arg('--out', os.path.join(REPO, 'assets', 'pond', 'book'))
os.makedirs(OUT, exist_ok=True)
info = json.load(open(os.path.join(SRC, 'book.json')))
for f in ('book.webp', 'pages.png'):
    shutil.copyfile(os.path.join(SRC, f), os.path.join(OUT, f))
info['src'] = 'book.webp'; info['pages'] = 'pages.png'
json.dump(info, open(os.path.join(OUT, 'book.json'), 'w'), indent=1)
print('book →', OUT, '(%d KB)' % (sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)) // 1024))
