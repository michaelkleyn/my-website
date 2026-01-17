# ASCII Audio Player Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a minimal ASCII particle-field audio visualizer in the upper right corner that plays an ambient track on loop.

**Architecture:** Fixed-position DOM element with a 6x8 character grid. Web Audio API's AnalyserNode provides frequency data. Particles change density/character based on audio. Title slides down on hover, links to Bandcamp.

**Tech Stack:** Vanilla JS, Web Audio API, CSS transitions

---

### Task 1: Create CSS for Audio Player

**Files:**
- Create: `css/audio-player.css`

**Step 1: Create the stylesheet**

```css
/* ASCII Audio Player Styles */

.audio-player {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 600;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.audio-visualizer {
  font-family: "Courier New", Courier, monospace;
  font-size: 10px;
  line-height: 1.2;
  color: #80cbc4;
  white-space: pre;
  cursor: pointer;
  opacity: 0.5;
  transition: opacity 0.3s ease;
  user-select: none;
}

.audio-visualizer.playing {
  opacity: 0.8;
}

.audio-visualizer:hover {
  opacity: 1;
}

.audio-track-info {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease-out, opacity 0.3s ease-out;
  opacity: 0;
}

.audio-player:hover .audio-track-info {
  max-height: 50px;
  opacity: 1;
}

.audio-track-link {
  font-family: "Cormorant Garamond", serif;
  font-size: 0.8rem;
  color: #80cbc4;
  text-decoration: none;
  display: block;
  margin-top: 8px;
  transition: text-decoration-color 0.2s ease;
}

.audio-track-link:hover {
  text-decoration: underline;
  text-decoration-color: #d11e06;
  text-decoration-thickness: 2px;
}

/* Hide on mobile */
@media (max-width: 768px) {
  .audio-player {
    display: none;
  }
}
```

**Step 2: Verify file created**

Run: `cat css/audio-player.css | head -20`
Expected: See the CSS content starting with `/* ASCII Audio Player Styles */`

**Step 3: Commit**

```bash
git add css/audio-player.css
git commit -m "feat: add audio player CSS styles"
```

---

### Task 2: Create AudioPlayer JavaScript Class

**Files:**
- Create: `js/audio-player.js`

**Step 1: Create the AudioPlayer class with particle grid**

```javascript
/**
 * ASCII Particle Field Audio Player
 * Visualizes audio as dancing particles in a 6x8 grid
 */

class AudioPlayer {
  constructor(options = {}) {
    this.audioSrc = options.audioSrc || '';
    this.trackName = options.trackName || 'Unknown Track';
    this.bandcampUrl = options.bandcampUrl || '#';

    // Grid dimensions
    this.cols = 6;
    this.rows = 8;

    // Particle characters (sparse to dense)
    this.particles = [' ', '.', '·', '•', '°', '◦'];

    // Audio state
    this.audioContext = null;
    this.analyser = null;
    this.audioElement = null;
    this.isPlaying = false;
    this.hasInteracted = false;

    // Animation
    this.grid = [];
    this.animationId = null;

    this.init();
  }

  init() {
    this.createDOM();
    this.initGrid();
    this.setupEventListeners();
    this.startIdleAnimation();
  }

  createDOM() {
    // Container
    this.container = document.createElement('div');
    this.container.className = 'audio-player';

    // Visualizer (the particle grid)
    this.visualizer = document.createElement('pre');
    this.visualizer.className = 'audio-visualizer';

    // Track info (hidden until hover)
    this.trackInfo = document.createElement('div');
    this.trackInfo.className = 'audio-track-info';

    const trackLink = document.createElement('a');
    trackLink.className = 'audio-track-link';
    trackLink.href = this.bandcampUrl;
    trackLink.target = '_blank';
    trackLink.rel = 'noopener noreferrer';
    trackLink.textContent = this.trackName;

    this.trackInfo.appendChild(trackLink);
    this.container.appendChild(this.visualizer);
    this.container.appendChild(this.trackInfo);

    document.body.appendChild(this.container);
  }

  initGrid() {
    this.grid = [];
    for (let y = 0; y < this.rows; y++) {
      this.grid[y] = [];
      for (let x = 0; x < this.cols; x++) {
        this.grid[y][x] = 0; // intensity 0-5
      }
    }
  }

  setupEventListeners() {
    // Click visualizer to play/pause
    this.visualizer.addEventListener('click', () => {
      if (!this.hasInteracted) {
        this.initAudio();
      } else {
        this.togglePlayback();
      }
    });

    // First interaction anywhere on page starts audio
    const startOnInteraction = () => {
      if (!this.hasInteracted) {
        this.initAudio();
      }
      document.removeEventListener('click', startOnInteraction);
    };
    document.addEventListener('click', startOnInteraction);
  }

  async initAudio() {
    if (this.hasInteracted) return;
    this.hasInteracted = true;

    try {
      // Create audio context
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

      // Create analyser
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;

      // Create audio element
      this.audioElement = new Audio(this.audioSrc);
      this.audioElement.loop = true;
      this.audioElement.crossOrigin = 'anonymous';

      // Connect audio element to analyser
      const source = this.audioContext.createMediaElementSource(this.audioElement);
      source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);

      // Start playback
      await this.audioElement.play();
      this.isPlaying = true;
      this.visualizer.classList.add('playing');

      // Switch from idle to reactive animation
      this.stopIdleAnimation();
      this.startReactiveAnimation();

      // Ripple effect on start
      this.triggerRipple();

    } catch (error) {
      console.error('Audio initialization failed:', error);
    }
  }

  togglePlayback() {
    if (!this.audioElement) return;

    if (this.isPlaying) {
      this.audioElement.pause();
      this.isPlaying = false;
      this.visualizer.classList.remove('playing');
    } else {
      this.audioElement.play();
      this.isPlaying = true;
      this.visualizer.classList.add('playing');
    }
  }

  // Idle animation - subtle drift
  startIdleAnimation() {
    const animate = () => {
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          // Random drift between 0 and 1 (sparse particles)
          this.grid[y][x] = Math.random() < 0.3 ? 1 : 0;
        }
      }
      this.render();
      this.idleAnimationId = setTimeout(() => {
        this.idleAnimationId = requestAnimationFrame(animate);
      }, 200); // Slow update for idle
    };
    this.idleAnimationId = requestAnimationFrame(animate);
  }

  stopIdleAnimation() {
    if (this.idleAnimationId) {
      cancelAnimationFrame(this.idleAnimationId);
      clearTimeout(this.idleAnimationId);
      this.idleAnimationId = null;
    }
  }

  // Reactive animation - responds to audio
  startReactiveAnimation() {
    const frequencyData = new Uint8Array(this.analyser.frequencyBinCount);

    const animate = () => {
      this.analyser.getByteFrequencyData(frequencyData);

      // Map frequency bands to grid rows (low freq = bottom, high = top)
      for (let y = 0; y < this.rows; y++) {
        // Invert y so low frequencies are at bottom
        const freqIndex = Math.floor((this.rows - 1 - y) * (frequencyData.length / this.rows));
        const intensity = frequencyData[freqIndex] / 255;

        for (let x = 0; x < this.cols; x++) {
          // Add some randomness for organic feel
          const noise = (Math.random() - 0.5) * 0.3;
          const value = Math.max(0, Math.min(1, intensity + noise));
          this.grid[y][x] = Math.floor(value * (this.particles.length - 1));
        }
      }

      this.render();
      this.animationId = requestAnimationFrame(animate);
    };
    this.animationId = requestAnimationFrame(animate);
  }

  // Ripple effect when audio starts
  triggerRipple() {
    const centerX = Math.floor(this.cols / 2);
    const centerY = Math.floor(this.rows / 2);

    for (let ring = 0; ring < Math.max(this.cols, this.rows); ring++) {
      setTimeout(() => {
        for (let y = 0; y < this.rows; y++) {
          for (let x = 0; x < this.cols; x++) {
            const dist = Math.abs(x - centerX) + Math.abs(y - centerY);
            if (dist === ring) {
              this.grid[y][x] = this.particles.length - 1; // Max intensity
            }
          }
        }
        this.render();
      }, ring * 50);
    }
  }

  render() {
    let output = '';
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        output += this.particles[this.grid[y][x]];
      }
      if (y < this.rows - 1) output += '\n';
    }
    this.visualizer.textContent = output;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Only initialize if audio source is configured
  const audioConfig = window.AUDIO_PLAYER_CONFIG;
  if (audioConfig && audioConfig.audioSrc) {
    window.audioPlayer = new AudioPlayer(audioConfig);
  }
});
```

**Step 2: Verify file created**

Run: `cat js/audio-player.js | head -30`
Expected: See the class definition starting with the comment block

**Step 3: Commit**

```bash
git add js/audio-player.js
git commit -m "feat: add AudioPlayer class with particle visualization"
```

---

### Task 3: Add Player to index.html

**Files:**
- Modify: `index.html`

**Step 1: Add CSS link in head (after popups.css line)**

Find line with `popups.css` and add after it:
```html
    <link rel="stylesheet" href="css/audio-player.css" />
```

**Step 2: Add config and script before closing body tag**

Find line with `</body>` and add before it:
```html
    <script>
      // Audio player configuration
      window.AUDIO_PLAYER_CONFIG = {
        audioSrc: './assets/ambient-track.mp3',
        trackName: 'Track Name',
        bandcampUrl: 'https://bandcamp.com/your-track-url'
      };
    </script>
    <script src="./js/audio-player.js"></script>
```

**Step 3: Verify changes**

Run: `grep -n "audio-player" index.html`
Expected: See both the CSS link and script references

**Step 4: Commit**

```bash
git add index.html
git commit -m "feat: integrate audio player into index.html"
```

---

### Task 4: Test in Browser

**Step 1: Start local server**

Run: `python3 -m http.server 8000` (or your preferred server)

**Step 2: Manual verification checklist**

Open `http://localhost:8000` and verify:

- [ ] Particle grid visible in upper right corner
- [ ] Particles show subtle idle animation (dots drifting)
- [ ] Opacity is dimmed (0.5) before interaction
- [ ] Click anywhere on page triggers audio and ripple effect
- [ ] Particles react to audio frequency
- [ ] Hover reveals track title sliding down
- [ ] Title links to Bandcamp (opens new tab)
- [ ] Click on visualizer pauses/resumes audio

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete ASCII audio player implementation"
```

---

### Task 5: User Provides Audio File

**Required from user:**
- Audio file (MP3 preferred) → save to `assets/ambient-track.mp3`
- Track name for display
- Bandcamp URL for the link

Update `window.AUDIO_PLAYER_CONFIG` in `index.html` with actual values.
