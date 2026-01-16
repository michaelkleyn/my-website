# ASCII Audio Player Design

## Overview

A minimal ASCII particle-field audio visualizer in the upper right corner. Plays a single ambient track on loop with reactive visuals.

## Structure & Position

- Fixed position, upper right corner
- Same visual layer as existing ASCII animations (z-index ~500)
- Container: ~6x8 monospace characters
- Color: Teal `#80cbc4` to match existing ASCII art

## Particle Behavior

**Character set**: `. · • ° ∘ ◦`

**Idle state** (before audio starts):
- Particles drift slowly between `.` and `·`
- Subtle random variation, like static electricity
- Dimmed opacity (0.5) to hint "not yet active"

**Playing state**:
- Web Audio API analyzes frequency data
- Low frequencies affect bottom rows, highs affect top
- Louder = denser characters (`•`, `°`)
- Organic, dust-mote aesthetic (not rigid EQ bars)

**Transition**:
- On audio start: brief ripple outward from center
- Then settles into reactive mode
- Opacity increases to 0.8

## Hover Interaction

1. Track title slides down from beneath particle field (300ms ease-out)
2. Title styling: Cormorant Garamond, ~0.8rem, teal color
3. Title is a link to Bandcamp (opens new tab)
4. Hover on title: red `#d11e06` underline accent
5. Mouse leave: title slides back up (300ms ease-in)

## Click Behavior

- Click on visualizer: play/pause toggle
- Click on title: opens Bandcamp URL in new tab

## Auto-play Handling

Browsers block auto-play until user interaction. Graceful fallback:

1. **Page load**: Audio context created but suspended. Idle particle animation.
2. **First interaction**: Any click/tap starts audio. Ripple effect, particles wake up.
3. **No intrusive prompts**: Visualizer just looks slightly dormant until interaction.

Once playing, audio loops seamlessly.

## Technical Implementation

- `AudioContext` + `AnalyserNode` for frequency data
- Canvas or DOM-based character grid (DOM likely simpler for this size)
- Single audio file served from assets
- CSS transitions for title slide animation
- Event listener on document for first interaction

## Files to Create/Modify

- `js/audio-player.js` - new file, AudioPlayer class
- `css/audio-player.css` - new file, styling
- `index.html` - add player container and script/css includes
- `assets/` - ambient audio file (user will provide)
