# Sidebar: Latent Space Aesthetic

## Vision

The sidebar as a window into the latent space - the dreaming mind of a machine. A serene, generative space where forms emerge from whiteness and dissolve back. Inspired by Brian Eno and Fred Again's "Cmon" - ambient, present, alive but not demanding.

The tiles are sentient particles. They breathe. They fire neural arcs like synapses. They sense the cursor and gracefully part around it, phasing into another dimension as they do.

## Three Layers of Life

### 1. Breathing (Constant)

Each tile gently pulses - opacity and subtle scale - like a sleeping creature's chest rising and falling.

**Behavior:**
- Cycle duration: 4-6 seconds per breath
- Opacity range: 0.3 → 0.6 → 0.3
- Scale: 1.0 → 1.02 → 1.0 (barely perceptible)
- Phase offset: each tile starts at random point in cycle (not synchronized)

**Feel:** Bioluminescent plankton in still water. Present, not demanding.

### 2. Neural Arcs (Spontaneous)

Currents that spark to life and travel through the grid like electricity finding the path of least resistance.

**Behavior:**
- Origin: Random tile
- Timing: Every 8-20 seconds (randomized)
- Path: Organic, not grid-locked. Can curve, can fork.
- Speed: 30-50ms between cells
- Trail: 3-5 cells lit behind leading edge, fading in intensity
- Length: 10-25 cells before dissipation
- Variation: Sometimes single arcs, sometimes pairs, occasionally forking

**Feel:** Synapses firing in a resting brain. Background processes of a dreaming machine.

### 3. Cursor Interaction (On Hover)

Tiles sense the cursor approaching and drift away, rotating and chromatic-splitting as they flee.

**Detection:**
- Radius: ~80-100px from cursor
- Anticipation: Tiles react before direct contact

**Tile Personalities:**
Each tile is assigned a unique "fingerprint" of reaction parameters at page load. All tiles exhibit the same behaviors, but with different intensities:

| Property | Range | What it controls |
|----------|-------|------------------|
| rotateX | 10-45° | Flip on horizontal axis |
| rotateY | 10-45° | Flip on vertical axis |
| rotateZ | 0-30° | Spin flat |
| chromaticOffset | 1-4px | RGB channel separation (subtle ghosting) |
| scaleFactor | 0.8-0.95 | How much it shrinks |
| fadeFactor | 0.5-0.9 | How much it fades |

**Movement:**
- Repulsion: Tiles translate away from cursor (closer = stronger)
- All properties animate simultaneously, each at tile's unique intensity
- Easing: Spring/elastic - overshoot slightly, then settle

**Chromatic Aberration:**
- Subtle ghosting effect - barely there, like a visual echo
- RGB channels offset slightly as tile moves
- Intensity proportional to tile's chromaticOffset parameter AND movement distance

**Recovery:**
- Tiles drift back slowly when cursor leaves
- All properties animate back to resting state
- Float home like moving through water

**Feel:** Parting through a field of aware particles. Each with its own character. They're graceful, not afraid. Phasing momentarily into another dimension to let you pass.

## Technical Approach

### anime.js
- Breathing: Timeline with staggered animations, random phase offsets
- Neural arcs: Staggered propagation along dynamically generated paths
- Cursor interaction: Spring physics for repulsion and return

### CSS
- Chromatic aberration via offset box-shadows or pseudo-elements
- Base tile styling with CSS custom properties for animation targets

### Vanilla JS
- Cursor position tracking
- Repulsion vector calculations (direction and magnitude from cursor to each tile)
- Path generation for neural arcs (weighted random neighbor selection)

## Resting State Color Palette

Soft, ethereal - emerging from and returning to near-white:
- Base: Very light gray or off-white
- Breathing peak: Subtle warm or cool tint
- Arc color: Soft glow (could be warm amber or cool blue-white)
- Chromatic split: Pure R/G/B separation

## Open Questions

- Should arcs have color, or be pure light/white?
- Should there be sound? (Future consideration)
