// Visitors — the visitor UI outside the card: the button and the "your fish is in the pond" note (and the lab's demo fill).
import { P } from '../config.js';
import { Residents } from '../residents.js';
import { PondStore } from '../store.js';
import { Designer } from './designer.js';

var root = typeof document !== 'undefined' ? document : null, school = null;
var $ = function (s) { return root.querySelector(s); };

export var DEMO_NAMES = ['Mochi', 'Pebble', 'Juniper', 'Ferdinand', 'Clementine', 'Ozzy', 'Bramble', 'Sorrel', 'Pip', 'Hazel', 'Marlow', 'Tuppence', 'Biscuit', 'Nori', 'Wren',
  'Otto', 'Saffron', 'Lupin', 'Quill', 'Dash', 'Willow', 'Hobbes', 'Maple', 'Tansy', 'Rue', 'Fig', 'Bea', 'Kit', 'Loki', 'Poppy', 'Ember', 'Sable'];

export var Visitors = {
  refresh: function () {
    var on = !!P.visitorsOn; $('#visitor-ui').hidden = !on; $('#fd-cap').textContent = P.visitorCap;
    var n = Residents.count(); $('#fd-count').textContent = n + ' of ' + P.visitorCap + ' fish in the pond';
    var mine = PondStore.mine(), here = !!(mine && school.findResident(mine.id));
    var note = $('#my-fish-note'); note.textContent = '';
    if (mine && here) {
      note.hidden = false;
      var b = document.createElement('b'); b.textContent = mine.name;
      note.appendChild(document.createTextNode('Your fish ')); note.appendChild(b); note.appendChild(document.createTextNode(' is in the pond · '));
      var f = document.createElement('button'); f.type = 'button'; f.textContent = 'find it'; f.addEventListener('click', function () { school.spotlight(mine.id); }); note.appendChild(f);
    } else if (mine && Residents.loaded) {
      note.hidden = false;
      var b2 = document.createElement('b'); b2.textContent = mine.name;
      note.appendChild(b2); note.appendChild(document.createTextNode(' has swum on — the pond keeps only the newest ' + P.visitorCap + '.'));
    } else note.hidden = true;
    $('#btn-leave').textContent = mine && here ? 'Leave a different fish' : 'Leave a fish';
    var vsNote = $('#vs-note'); if (vsNote) vsNote.textContent = 'Store: ' + (PondStore.mode === 'remote' ? 'remote' : 'this browser') + (PondStore.error ? ' (remote failed: ' + PondStore.error + ')' : '') + ' · ' + n + '/' + P.visitorCap + ' resident fish.';
  },
  /** Lab: fill the pond to capacity with random fish, to see (and measure) a full pond. */
  demo: function () {
    var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; }, i = 0;
    while (Residents.count() < P.visitorCap && i++ < 80) {
      var d = Designer.random(true), name = pick(DEMO_NAMES);
      var rec = PondStore.mode === 'local' ? PondStore.addLocal(name, d) : PondStore.fromRow({ id: 'demo-' + PondStore.uid(), name: name, params: d, created_at: new Date().toISOString() });
      Residents.add(rec);
    }
    Residents.trim(); Visitors.refresh();
  },
};

Visitors.init = function (opts) { opts = opts || {}; root = opts.root || root; school = opts.school || school; return Visitors; };
