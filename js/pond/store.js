// PondStore — where visitor fish live between visits: this browser (localStorage).
// The pond keeps the newest `visitorCap`; one fish per visitor; a design is never stored twice.
import { P } from './config.js';
import { normalizeDesign, designHash } from './design.js';
import { cleanName } from './util.js';

export var PondStore = {
  KEY: 'pond-fish', MINE: 'pond-mine',

  uid: function () {
    var a = new Uint8Array(9);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else for (var i = 0; i < a.length; i++) a[i] = Math.random() * 256;
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  },
  readLocal: function () { try { var l = JSON.parse(localStorage.getItem(this.KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } },
  writeLocal: function (l) { try { localStorage.setItem(this.KEY, JSON.stringify(l)); } catch (e) { /* private mode */ } },
  mine: function () { try { return JSON.parse(localStorage.getItem(this.MINE) || 'null'); } catch (e) { return null; } },
  setMine: function (m) { try { if (m) localStorage.setItem(this.MINE, JSON.stringify(m)); else localStorage.removeItem(this.MINE); } catch (e) { /* private mode */ } },
  fromRow: function (r) { return { id: String(r.id), name: cleanName(r.name) || 'Nameless', design: normalizeDesign(r.params), createdAt: r.created_at || '' }; },

  /** The fish in the pond, newest first. */
  list: function () { return Promise.resolve(this.listLocal()); },
  listLocal: function () { return this.readLocal().slice(-P.visitorCap).reverse().map(this.fromRow); },

  /** Put a design in the pond as this visitor's fish (replacing their earlier one). Resolves to the stored record. */
  leave: function (name, design) {
    var d = normalizeDesign(design), mine = this.mine() || {}, secret = mine.secret || this.uid();
    var l = this.readLocal().filter(function (r) { return r.id !== mine.id; });
    var hash = designHash(d);
    if (l.some(function (r) { return designHash(r.params) === hash; })) return Promise.reject(new Error('That exact fish already lives here — change something about it.'));
    var row = { id: this.uid(), name: name, params: d, created_at: new Date().toISOString() };
    l.push(row); while (l.length > P.visitorCap) l.shift();
    this.writeLocal(l); this.setMine({ id: row.id, secret: secret, name: name });
    return Promise.resolve(this.fromRow(row));
  },
  /** Lab only: add a fish that is nobody's (demo fill). */
  addLocal: function (name, design) {
    var l = this.readLocal(), row = { id: this.uid(), name: name, params: normalizeDesign(design), created_at: new Date().toISOString() };
    l.push(row); while (l.length > P.visitorCap) l.shift(); this.writeLocal(l); return this.fromRow(row);
  },
  clearLocal: function () { this.writeLocal([]); this.setMine(null); },
};
