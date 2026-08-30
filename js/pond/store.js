// PondStore — where visitor fish live between visits: this browser (localStorage) or a tiny PostgREST API
// (lab/pond/pond_fish.sql). The pond keeps the newest `visitorCap`; one fish per visitor; a design is never stored twice.
import { P } from './config.js';
import { normalizeDesign, designHash } from './design.js';
import { cleanName } from './util.js';

export var PondStore = {
  KEY: 'pond-fish', MINE: 'pond-mine',
  remote: null,
  /** Where fish live: a PostgREST/Supabase endpoint ({url, key}) or, without one, this browser. */
  init: function (opts) { var r = (opts && opts.remote) || (typeof window !== 'undefined' ? window.POND_REMOTE : null); this.remote = (r && r.url && r.key) ? r : null; this.mode = 'local'; this.error = null; return this; },
  mode: 'local', error: null,

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
  list: function () {
    var self = this;
    if (this.remote) {
      return this.api('GET', 'pond_fish?select=id,name,params,created_at&order=created_at.desc&limit=' + P.visitorCap)
        .then(function (rows) { self.mode = 'remote'; return rows.map(self.fromRow); })
        .catch(function (e) { self.fail(e); return self.listLocal(); });
    }
    return Promise.resolve(this.listLocal());
  },
  listLocal: function () { return this.readLocal().slice(-P.visitorCap).reverse().map(this.fromRow); },

  /** Put a design in the pond as this visitor's fish (replacing their earlier one). Resolves to the stored record. */
  leave: function (name, design) {
    var self = this, d = normalizeDesign(design), mine = this.mine() || {}, secret = mine.secret || this.uid();
    if (this.remote) {
      return this.api('POST', 'rpc/leave_fish', { p_name: name, p_params: d, p_secret: secret, p_replace: mine.id || null })
        .then(function (row) { var rec = self.fromRow(row); self.setMine({ id: rec.id, secret: secret, name: rec.name }); return rec; });
    }
    var l = this.readLocal().filter(function (r) { return r.id !== mine.id; });
    var hash = designHash(d);
    if (l.some(function (r) { return designHash(r.params) === hash; })) return Promise.reject(new Error('That exact fish already lives here — change something about it.'));
    var row = { id: this.uid(), name: name, params: d, created_at: new Date().toISOString() };
    l.push(row); while (l.length > P.visitorCap) l.shift();
    this.writeLocal(l); this.setMine({ id: row.id, secret: secret, name: name });
    return Promise.resolve(this.fromRow(row));
  },
  /** Lab only: add a fish that is nobody's (demo fill). Local store only. */
  addLocal: function (name, design) {
    var l = this.readLocal(), row = { id: this.uid(), name: name, params: normalizeDesign(design), created_at: new Date().toISOString() };
    l.push(row); while (l.length > P.visitorCap) l.shift(); this.writeLocal(l); return this.fromRow(row);
  },
  clearLocal: function () { this.writeLocal([]); this.setMine(null); },

  api: function (method, path, body) {
    var r = this.remote, h = { apikey: r.key, Authorization: 'Bearer ' + r.key, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    return fetch(r.url.replace(/\/$/, '') + '/rest/v1/' + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined }).then(function (res) {
      return res.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { /* not json */ } if (!res.ok) throw new Error((j && (j.message || j.hint)) || ('HTTP ' + res.status)); return j; });
    });
  },
  fail: function (e) { this.mode = 'local'; this.error = String((e && e.message) || e); console.warn('pond store: remote unavailable, using this browser only —', this.error); },
};
