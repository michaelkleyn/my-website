// Defaults, species presets, config migration and normalisation.
import { clone, clamp } from './util.js';

/** Bump when preset params change: pre-rendered atlases are keyed on it. */
export var PRESETS_VERSION = '1';

export var PLAIN6 = ['plain', 'plain', 'plain', 'plain', 'plain', 'plain'];

export var DEFAULTS = {
  // shape
  kind: 'fish', len: 320, height: 92, tailBend: 16, tailLen: 40, tailSpread: 42, dorsal: 34, curvature: 0.8, variety: 0.5,
  // paint
  brushScale: 3, seed: 4,
  washOn: true, washOpacity: 165, bleed: 0.28, bleedDir: 'out', texture: 0.55, border: 0.45, scatter: true,
  glazeOn: true, glazeOpacity: 75, glazeBleed: 0.35,
  markingsOn: true, markOpacity: 150, markBleed: 0.2, markScale: 1, markDensity: 1,
  outlineOn: true, outlineBrush: '2B', outlineWeight: 1.15, wiggle: 0,
  hatchOn: true, hatchBrush: '2H', hatchWeight: 0.7, hatchDist: 6, hatchAngle: 8, hatchRand: 0.65, hatchRegion: 'tail',
  finsOn: true, lineOn: true, eyeOn: true, eyeSize: 4,
  variants: 6,
  // palette rows: [wash, glaze, line, mark, sumi]
  palette: [
    ['#ff9878', '#ff5722', '#a63d1f', '#ff5722', '#2b2b2b'],
    ['#78c0e0', '#3f8fb5', '#1f4f6b', '#ff7f5c', '#1f4f6b'],
    ['#ffb8a0', '#ff7f5c', '#c2472a', '#ff5722', '#2b2b2b'],
    ['#9dd1e3', '#78c0e0', '#2f6f8c', '#ff7f5c', '#1f4f6b'],
    ['#ffd4c4', '#ff9878', '#b0522f', '#ff5722', '#2b2b2b'],
    ['#b9dee5', '#8bc9e1', '#3b7f9a', '#ff7f5c', '#1f4f6b'],
  ],
  patterns: PLAIN6.slice(),
  // school
  count: 28, sizeMin: 64, sizeMax: 130, speed: 46, turnRate: 2.6,
  neighborRadius: 130, separationRadius: 50, cohesion: 0.3, alignment: 60, separation: 2600,
  wander: 18, roam: true, roamPull: 0.06, edgeMode: 'walls', edgeMargin: 100,
  // motion
  animMode: 'spine', tailHz: 2.0, waveAmp: 0.11, headAmp: 0.015, waveLen: 1.1, waveProfile: 2.2, turnBend: 0.6,
  coastOn: true, coastEvery: 6, coastLen: 1.6, motionVariety: 0.6,
  // tank
  paper: '#f4f4f4', blend: 'source-over', alphaNear: 0.82, alphaFar: 0.62, mouse: 'none', mouseRadius: 180, showAtlas: false,
  // water — a ripple simulation the fish drive, drawn as ink lines along the wavefronts
  waterOn: true,
  rippleFishPct: 7, rippleBeat: 0.25, rippleSurfacing: 6, rippleTouch: 0.3,
  rippleDetail: 13, rippleLife: 0.28, rippleSpeed: 13,
  inkColor: '#89bee1', inkBrush: '2H', inkWeight: 2.1, inkOpacity: 0.08, inkDetail: 0.5, inkStrokes: 60, inkPenSpeed: 110, inkLife: 2.4, inkEvery: 450,
  pondOn: true, pondColor: '#a2e2fb', pondOpacity: 0.46, pondFlow: 0.9, pondSwirl: 18, pondSwirlSize: 2.95, pondBreathe: 0.98,
  styleMix: [],   // e.g. ['koi', 'minnow', 'pencil']: variant v takes the inking + shape of preset styleMix[v % 3]; behaviour stays
  // the compiled journal (boulder + notebook + page-turn rocks) placed on the pond
  journalOn: true, journalX: 0.14, journalY: 0.76, journalScale: 0.1, journalAvoid: 70, journalBounce: true, journalProps: [],
  // the rock as a crosshatch drawing, with the real rock revealed through a dissolving spotlight under the pointer
  rockOn: true, rockOnArrows: true, rockOnJournal: true, rockBrush: '2H', rockInk: '#5a4a3a', rockWeight: 0.9, rockSpacing: 1.0, rockAngle: 0, rockRand: 0.2, rockBands: 4, rockBody: 0.85,
  spotRadius: 140, spotFeather: 60, spotDissolve: 0.6, spotSpeed: 4,
  shadowOn: true, shadowStrength: 0.8, shadowX: 0, shadowY: 0, shadowSpread: 1.0, shadowSpacing: 1.0, shadowAngle: 30,
  // visitors: the "leave a fish" card. Designs live in the pond store; the pond paints them here with the same brushes.
  visitorsOn: true, visitorCap: 30, visitorHover: true,
  // book: the pond drawn on the pages of a journal photo (multiply), clipped to an editable page mask
  bookOn: true, bookZoom: 1.1, bookX: 0, bookY: 0, bookSpineShift: 0, bookSpineWidth: 80, bookSpineSoft: 30, bookInset: 8, bookFeather: 6, bookShowMask: false,
  bookmarkX: 115, bookmarkY: 60, bookmarkW: 300, bookmarkRot: 0,
  bookBrushSize: 60, bookBrushSoft: 0.5, bookMask: '',
};

export var PATTERN_NAMES = ['plain', 'kohaku', 'sanke', 'showa', 'bekko', 'tancho', 'asagi'];

export var PRESETS = [
  { id: 'koi', name: 'Watercolor Koi', swatch: '#ff5722',
    note: 'Six different koi: Kohaku, Asagi, Sanke, an orange Ogon, Tancho and Showa. Markings are painted in body space so they bend with the fish. Each variant also gets its own proportions (Variety) and its own swimming rhythm (Motion). Approved config v5: the school is a third watercolour koi, a third ink minnows, a third pencil studies (Style mix), over the ripple pond.',
    params: { kind: 'fish', len: 320, height: 92, tailBend: 32, tailLen: 40, tailSpread: 66, dorsal: 34, curvature: 0.8, variety: 0.75, brushScale: 2.5, seed: 8,
      washOn: true, washOpacity: 165, bleed: 0.38, bleedDir: 'out', texture: 0.55, border: 0.8, scatter: true, glazeOn: true, glazeOpacity: 155, glazeBleed: 0.26,
      markingsOn: true, markOpacity: 150, markBleed: 0.2, markScale: 1.6, markDensity: 1, outlineOn: true, outlineBrush: '2B', outlineWeight: 1.15, wiggle: 0,
      hatchOn: true, hatchBrush: '2H', hatchWeight: 0.7, hatchDist: 6, hatchAngle: 8, hatchRand: 0.65, hatchRegion: 'tail', finsOn: true, lineOn: true, eyeOn: true, eyeSize: 4,
      palette: [['#fff1e8', '#ffe0d2', '#b0522f', '#ff5722', '#2b2b2b'], ['#9dd1e3', '#78c0e0', '#2f6f8c', '#ff7f5c', '#1f4f6b'], ['#fff1e8', '#ffe0d2', '#a63d1f', '#ff7f5c', '#2b3a48'],
                ['#ff9878', '#ff5722', '#a63d1f', '#ff5722', '#2b2b2b'], ['#fbf5f0', '#f1e6de', '#b0522f', '#ff5722', '#2b2b2b'], ['#fff1e8', '#ffe0d2', '#8a3d22', '#ff5722', '#2b3a48']],
      patterns: ['kohaku', 'asagi', 'sanke', 'plain', 'tancho', 'showa'], styleMix: ['koi', 'minnow', 'pencil'], variants: 9,
      count: 35, sizeMin: 46, sizeMax: 96, speed: 46, turnRate: 2.6, neighborRadius: 55, separationRadius: 103, cohesion: 1.45, alignment: 60, separation: 7500, wander: 16,
      roam: false, roamPull: 0.06, edgeMode: 'wrap', edgeMargin: 100, animMode: 'spine', tailHz: 1.8, waveAmp: 0.145, headAmp: 0.025, waveLen: 1.85, waveProfile: 5, turnBend: 0,
      coastOn: true, coastEvery: 12.5, coastLen: 1.6, motionVariety: 0.15, paper: '#f4f4f4', blend: 'source-over', alphaNear: 0.82, alphaFar: 0.62, mouse: 'none', mouseRadius: 180 } },
  { id: 'minnow', name: 'Ink Minnow', swatch: '#2b3a48',
    note: 'No wash at all — a rotring outline and cross-hatching carry the whole body. Slim, quick, many.',
    params: { len: 210, height: 58, tailSpread: 34, dorsal: 22, curvature: 0.35, washOn: false, glazeOn: false, markingsOn: false,
      outlineBrush: 'rotring', outlineWeight: 0.9, wiggle: 1, hatchOn: true, hatchRegion: 'body',
      hatchBrush: 'rotring', hatchWeight: 0.55, hatchDist: 5, hatchAngle: 38, hatchRand: 0.3,
      palette: [['#2b3a48', '#2b3a48', '#1b2631'], ['#31465a', '#31465a', '#1b2631'], ['#3d5166', '#3d5166', '#22303c'],
                ['#2b3a48', '#2b3a48', '#1b2631'], ['#4a5d70', '#4a5d70', '#22303c'], ['#2b3a48', '#2b3a48', '#1b2631']],
      count: 42, sizeMin: 46, sizeMax: 90, speed: 62, turnRate: 3.2, cohesion: 0.5, neighborRadius: 110, tailHz: 2.8, waveAmp: 0.13, waveLen: 0.9 } },
  { id: 'charcoal', name: 'Charcoal Shoal', swatch: '#6b6b6b',
    note: 'Charcoal outline, dusty grey washes with lots of texture, no hatch. Few, large, slow.',
    params: { len: 270, height: 96, tailSpread: 54, dorsal: 40, curvature: 0.45, markingsOn: false,
      washOpacity: 120, bleed: 0.4, texture: 0.85, border: 0.7, glazeOpacity: 60, glazeBleed: 0.5,
      outlineBrush: 'charcoal', outlineWeight: 1.6, wiggle: 3, hatchOn: false, lineOn: false,
      palette: [['#9a9a9a', '#6b6b6b', '#2e2e2e'], ['#b3aca4', '#7d766e', '#3a3531'], ['#8f9aa3', '#5d6a75', '#2b333a'],
                ['#c0673f', '#8a4426', '#3a2418'], ['#a6a6a6', '#707070', '#2e2e2e'], ['#9aa8b0', '#66757f', '#2b333a']],
      count: 16, sizeMin: 90, sizeMax: 170, speed: 30, turnRate: 1.8, cohesion: 0.25, separationRadius: 48, tailHz: 1.4, waveAmp: 0.09, waveLen: 1.3 } },
  { id: 'tetra', name: 'Marker Tetra', swatch: '#ff5722',
    note: 'Flat marker fills — bleed almost off, no scatter — with a marker outline. Deep bodies, tight fast school.',
    params: { len: 200, height: 104, tailSpread: 48, dorsal: 30, curvature: 0.3, markingsOn: false,
      washOpacity: 200, bleed: 0.08, texture: 0.2, border: 0.2, scatter: false, glazeOpacity: 110, glazeBleed: 0.1,
      outlineBrush: 'marker', outlineWeight: 1.0, wiggle: 0, hatchOn: false, lineOn: false,
      palette: [['#ff5722', '#c2472a', '#7a2810'], ['#78c0e0', '#3f8fb5', '#1f4f6b'], ['#ff7f5c', '#ff5722', '#7a2810'],
                ['#ffb8a0', '#ff7f5c', '#a63d1f'], ['#3f8fb5', '#1f4f6b', '#0f2c3d'], ['#ffd4c4', '#ff9878', '#a63d1f']],
      count: 32, sizeMin: 54, sizeMax: 100, speed: 58, turnRate: 3.4, cohesion: 0.6, alignment: 90, neighborRadius: 120, tailHz: 2.6, waveAmp: 0.1, waveProfile: 3 } },
  { id: 'sardine', name: 'Spray Sardines', swatch: '#b9c6cf',
    note: 'Spray-can outline over a thin silver wash. Small, quick, crowded — the classic bait ball.',
    params: { len: 200, height: 52, tailSpread: 36, dorsal: 16, curvature: 0.35, markingsOn: false,
      washOpacity: 110, bleed: 0.2, texture: 0.4, border: 0.3, glazeOn: true, glazeOpacity: 60, glazeBleed: 0.2,
      outlineBrush: 'spray', outlineWeight: 1.4, wiggle: 0, hatchOn: false, finsOn: false,
      palette: [['#c9d3da', '#8fa3b1', '#3e4f5c'], ['#d5dde3', '#9db0bd', '#46586a'], ['#b9c6cf', '#7f95a5', '#33434f'],
                ['#cfd8de', '#93a7b5', '#3e4f5c'], ['#c2ced6', '#889daf', '#3a4a58'], ['#d9e0e5', '#a2b3bf', '#46586a']],
      count: 44, sizeMin: 40, sizeMax: 70, speed: 70, turnRate: 4, cohesion: 0.7, alignment: 110, separationRadius: 24, neighborRadius: 100, tailHz: 3.2, waveAmp: 0.14, waveLen: 0.8, coastOn: false } },
  { id: 'pencil', name: 'Pencil Study', swatch: '#4a4a4a',
    note: 'Graphite only: HB outline, 2H hatching across the whole body, a lateral line. Like a sketchbook page.',
    params: { curvature: 0.35, washOn: false, glazeOn: false, markingsOn: false, outlineBrush: 'HB', outlineWeight: 1.2, wiggle: 2,
      hatchOn: true, hatchRegion: 'body', hatchBrush: '2H', hatchWeight: 0.6, hatchDist: 7, hatchAngle: 25, hatchRand: 0.35,
      palette: [['#4a4a4a', '#4a4a4a', '#3a3a3a'], ['#5a5a5a', '#5a5a5a', '#3a3a3a'], ['#4a4a4a', '#4a4a4a', '#2e2e2e'],
                ['#666666', '#666666', '#3a3a3a'], ['#4a4a4a', '#4a4a4a', '#3a3a3a'], ['#5a5a5a', '#5a5a5a', '#2e2e2e']],
      count: 22, sizeMin: 70, sizeMax: 140, speed: 40, cohesion: 0.3 } },
  { id: 'swallow', name: 'Swallow Flock', swatch: '#1f4f6b',
    note: 'Same boids, different animal: a top-down swallow. Uses the painted-poses animation (three wing positions) instead of the spine warp. Ink wash, HB outline, fast and twitchy.',
    params: { kind: 'swallow', len: 190, height: 260, tailBend: 18, tailLen: 40, tailSpread: 70, dorsal: 0, curvature: 0.15, variety: 0.3, markingsOn: false,
      washOpacity: 120, bleed: 0.22, texture: 0.5, border: 0.4, glazeOn: true, glazeOpacity: 60, glazeBleed: 0.25,
      outlineBrush: 'HB', outlineWeight: 1.0, wiggle: 1, hatchOn: true, hatchRegion: 'tail', hatchDist: 5, hatchAngle: 0, hatchRand: 0.2,
      finsOn: true, lineOn: false, eyeSize: 2.5,
      palette: [['#1f4f6b', '#0f2c3d', '#0b1c27'], ['#2b3a48', '#1b2631', '#0e151c'], ['#3f8fb5', '#1f4f6b', '#0f2c3d'],
                ['#2b3a48', '#1b2631', '#0e151c'], ['#1f4f6b', '#0f2c3d', '#0b1c27'], ['#34485a', '#22303c', '#0e151c']],
      count: 36, sizeMin: 60, sizeMax: 120, speed: 85, turnRate: 3.6, neighborRadius: 170, separationRadius: 44,
      cohesion: 0.4, alignment: 80, wander: 40, animMode: 'poses', tailHz: 3.0, coastOn: true, coastEvery: 3, coastLen: 1.2, edgeMode: 'wrap', alphaFar: 0.5 } },
];

export var BRUSHES = ['2B', 'HB', '2H', 'cpencil', 'pen', 'rotring', 'spray', 'marker', 'marker2', 'charcoal', 'hatch_brush'];

// Each control: key, label, kind, and whether changing it requires a repaint.

/** Fill in anything a config is missing: 5-colour palette rows, 6 patterns, new keys. */
export function normalize(P) {
  Object.keys(DEFAULTS).forEach(function (k) { if (P[k] === undefined) P[k] = clone(DEFAULTS[k]); });
  if (!Array.isArray(P.palette) || !P.palette.length) P.palette = clone(DEFAULTS.palette);
  while (P.palette.length < 6) P.palette.push(clone(P.palette[P.palette.length - 1]));
  P.palette = P.palette.slice(0, 6).map(function (row) {
    row = row.slice(0, 5);
    while (row.length < 3) row.push(row[row.length - 1] || '#333333');
    if (row.length < 4) row.push('#ff5722');
    if (row.length < 5) row.push('#2b2b2b');
    return row;
  });
  if (!Array.isArray(P.patterns)) P.patterns = PLAIN6.slice();
  while (P.patterns.length < 6) P.patterns.push('plain');
  P.patterns = P.patterns.slice(0, 6).map(function (n) { return PATTERN_NAMES.indexOf(n) >= 0 ? n : 'plain'; });
  P.variants = clamp(Math.round(P.variants || 6), 1, 9);
  if (!Array.isArray(P.styleMix)) P.styleMix = [];
  return P;
}
export function merge(base, over) {
  var out = clone(base);
  Object.keys(over || {}).forEach(function (k) { out[k] = clone(over[k]); });
  return normalize(out);
}
