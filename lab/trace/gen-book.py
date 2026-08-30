"""Build the book data (photo + page masks) for the Boids Lab's book mode and inject it into ../boids-lab.html
between the <script id="book-data"> markers. usage: gen-book.py"""
import base64, json, os, re
T = os.path.dirname(os.path.abspath(__file__)); W = os.path.dirname(T); B = os.path.join(T, 'data', 'book')
def durl(path, mime): return 'data:' + mime + ';base64,' + base64.b64encode(open(path, 'rb').read()).decode()
info = json.load(open(os.path.join(B, 'book.json')))
info['src'] = durl(os.path.join(B, 'book.webp'), 'image/webp'); info['pages'] = durl(os.path.join(B, 'pages.png'), 'image/png')
js = json.dumps(info)
block = '<script id="book-data">window.BOOK = ' + js + ';</script>'
lab = open(os.path.join(W, 'boids-lab.html')).read()
if '<script id="book-data">' in lab:
    lab = re.sub(r'<script id="book-data">.*?</script>', lambda m: block, lab, count=1, flags=re.S)
else:
    anchor = '<script src="https://cdn.jsdelivr.net/npm/p5.brush@2.2.2/dist/brush.js"></script>'
    assert anchor in lab; lab = lab.replace(anchor, block + '\n' + anchor, 1)
open(os.path.join(W, 'boids-lab.html'), 'w').write(lab); print('book data', len(js) // 1024, 'KB → boids lab', len(lab) // 1024, 'KB')
