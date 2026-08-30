// The live config. `P` is a live binding: importers see every replace(); only this module rebinds it.
import { DEFAULTS, merge } from './presets.js';
import { createEmitter } from './emitter.js';

export var bus = createEmitter();
export let P = merge(DEFAULTS, {});
export let activePreset = null;
export var on = bus.on, off = bus.off;
/** Replace the whole config (a preset, pasted JSON). */
export function replace(obj, presetId) { P = merge(DEFAULTS, obj || {}); activePreset = presetId === undefined ? null : presetId; bus.emit('replace', { P: P, preset: activePreset }); return P; }
/** Change some keys in place; clears the active preset unless opts.keepPreset. */
export function patch(partial, opts) { opts = opts || {}; var keys = Object.keys(partial || {}); keys.forEach(function (k) { P[k] = partial[k]; }); if (!opts.keepPreset) activePreset = null; bus.emit('change', { keys: keys, P: P, source: opts.source }); }
export function set(k, v, opts) { var o = {}; o[k] = v; patch(o, opts); }
export function setActivePreset(id) { activePreset = id; bus.emit('preset', { id: id }); }
export function snapshot() { return JSON.parse(JSON.stringify(P)); }
