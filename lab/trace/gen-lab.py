"""Embed data/objects.json + data/ref-720.jpg into lab-template.html → ../journal-trace.html"""
import json, base64, os
HERE = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(os.path.join(HERE, 'data', 'objects.json')))
ref = base64.b64encode(open(os.path.join(HERE, 'data', 'ref-720.jpg'), 'rb').read()).decode()
tpl = open(os.path.join(HERE, 'lab-template.html')).read()
html = tpl.replace('__OBJECTS__', json.dumps(data, separators=(',', ':'))).replace('__REF__', ref)
out = os.path.join(os.path.dirname(HERE), 'journal-trace.html')
open(out, 'w').write(html)
print('wrote', out, len(html) // 1024, 'KB')
