/**
 * Sidebar Latent Space
 *
 * Three layers of life:
 * 1. Breathing - subtle opacity/scale pulses, each tile on its own rhythm
 * 2. Neural Arcs - sparks that travel organically through the grid
 * 3. Cursor Interaction - tiles flee, rotate, chromatic-split, then drift home
 */

(function() {
  'use strict';

  // Destructure anime.js v4 methods
  const { animate } = anime;

  const GRID_COLS = 3;
  const GRID_ROWS = 20;
  const TOTAL_TILES = GRID_COLS * GRID_ROWS;

  // Configuration
  const CONFIG = {
    // Breathing is handled by CSS animation (see style.css)
    arcs: {
      minInterval: 8000,
      maxInterval: 20000,
      speed: 40, // ms between cells
      trailLength: 4,
      minLength: 10,
      maxLength: 25
    },
    cursor: {
      radius: 100,
      maxTranslate: 30,
      returnDuration: 800
    }
  };

  // Tile personalities - randomized on init
  const tilePersonalities = [];

  // State
  let tiles = [];
  let isInitialized = false;
  let mouseX = -1000;
  let mouseY = -1000;
  let arcTimeout = null;
  let tileAnimations = new Map(); // Track active animations for cleanup

  /**
   * Initialize the sidebar system
   */
  function init() {
    const sidebar = document.querySelector('.gradient-sidebar');
    if (!sidebar) return;

    tiles = Array.from(sidebar.querySelectorAll('.sidebar-row')).slice(0, TOTAL_TILES);
    if (tiles.length === 0) return;

    // Generate unique personality for each tile
    tiles.forEach((tile, index) => {
      tilePersonalities[index] = generatePersonality();

      // Store original position for cursor interaction
      tile.dataset.index = index;
      tile.dataset.originalTransform = '';

      // Add perspective to parent for 3D transforms
      tile.style.transformStyle = 'preserve-3d';
    });

    // Add perspective to sidebar
    sidebar.style.perspective = '500px';
    sidebar.style.perspectiveOrigin = 'center center';

    // Start systems
    startBreathing();
    scheduleNextArc();
    setupCursorTracking(sidebar);

    isInitialized = true;
    console.log('Sidebar Latent Space initialized');
  }

  /**
   * Generate a unique personality for a tile
   */
  function generatePersonality() {
    return {
      // Breathing phase offset (0-1, multiplied by 500ms for stagger)
      breathPhase: random(0, 6),

      // Cursor reaction intensities
      rotateX: random(10, 45),
      rotateY: random(10, 45),
      rotateZ: random(0, 30)
    };
  }

  /**
   * Random number between min and max
   */
  function random(min, max) {
    return Math.random() * (max - min) + min;
  }

  /**
   * Get grid position from index
   */
  function indexToGrid(index) {
    return {
      row: Math.floor(index / GRID_COLS),
      col: index % GRID_COLS
    };
  }

  /**
   * Get index from grid position
   */
  function gridToIndex(row, col) {
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) return -1;
    return row * GRID_COLS + col;
  }

  // ============================================
  // Layer 1: Breathing
  // ============================================

  function startBreathing() {
    // Breathing is handled by CSS animation
    // Just add random delays so tiles don't sync
    tiles.forEach((tile, index) => {
      const personality = tilePersonalities[index];
      tile.style.animationDelay = `-${personality.breathPhase * 500}ms`;
    });
  }

  // ============================================
  // Layer 2: Neural Arcs
  // ============================================

  function scheduleNextArc() {
    const delay = random(CONFIG.arcs.minInterval, CONFIG.arcs.maxInterval);
    arcTimeout = setTimeout(() => {
      fireArc();
      scheduleNextArc();
    }, delay);
  }

  function fireArc() {
    // Random starting position
    const startIndex = Math.floor(random(0, TOTAL_TILES));
    const arcLength = Math.floor(random(CONFIG.arcs.minLength, CONFIG.arcs.maxLength));

    // Generate organic path
    const path = generateArcPath(startIndex, arcLength);

    // Animate the arc
    animateArc(path);
  }

  function generateArcPath(startIndex, length) {
    const path = [startIndex];
    let currentIndex = startIndex;
    let prevDirection = null;

    for (let i = 1; i < length; i++) {
      const { row, col } = indexToGrid(currentIndex);

      // Get valid neighbors
      const neighbors = [];
      const directions = [
        { dr: -1, dc: 0, name: 'up' },
        { dr: 1, dc: 0, name: 'down' },
        { dr: 0, dc: -1, name: 'left' },
        { dr: 0, dc: 1, name: 'right' },
        { dr: -1, dc: -1, name: 'upLeft' },
        { dr: -1, dc: 1, name: 'upRight' },
        { dr: 1, dc: -1, name: 'downLeft' },
        { dr: 1, dc: 1, name: 'downRight' }
      ];

      directions.forEach(dir => {
        const newRow = row + dir.dr;
        const newCol = col + dir.dc;
        const newIndex = gridToIndex(newRow, newCol);

        if (newIndex !== -1 && !path.includes(newIndex)) {
          // Weight toward continuing in similar direction
          let weight = 1;
          if (prevDirection && dir.name === prevDirection) weight = 3;
          if (prevDirection && dir.name.includes(prevDirection.replace('up', '').replace('down', '').replace('Left', '').replace('Right', ''))) weight = 2;

          for (let w = 0; w < weight; w++) {
            neighbors.push({ index: newIndex, direction: dir.name });
          }
        }
      });

      if (neighbors.length === 0) break;

      // Pick random neighbor (weighted)
      const chosen = neighbors[Math.floor(random(0, neighbors.length))];
      path.push(chosen.index);
      currentIndex = chosen.index;
      prevDirection = chosen.direction;
    }

    return path;
  }

  function animateArc(path) {
    path.forEach((tileIndex, pathIndex) => {
      setTimeout(() => {
        const tile = tiles[tileIndex];
        if (!tile) return;

        // Light up the tile with glow
        animate(tile, {
          filter: 'brightness(1.8)',
          boxShadow: '0 0 20px rgba(255, 255, 255, 0.6)',
          duration: 100,
          ease: 'outQuad',
          onComplete: () => {
            // Fade back based on trail position
            const trailDelay = CONFIG.arcs.trailLength * CONFIG.arcs.speed;
            setTimeout(() => {
              animate(tile, {
                filter: 'brightness(1)',
                boxShadow: '0 0 0px rgba(255, 255, 255, 0)',
                duration: 300,
                ease: 'outQuad'
              });
            }, trailDelay);
          }
        });
      }, pathIndex * CONFIG.arcs.speed);
    });
  }

  // ============================================
  // Layer 3: Cursor Interaction
  // ============================================

  function setupCursorTracking(sidebar) {
    // Track mouse position relative to viewport
    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      updateCursorInteraction();
    });

    document.addEventListener('mouseleave', () => {
      mouseX = -1000;
      mouseY = -1000;
      resetAllTiles();
    });
  }

  function updateCursorInteraction() {
    tiles.forEach((tile, index) => {
      const rect = tile.getBoundingClientRect();
      const tileCenterX = rect.left + rect.width / 2;
      const tileCenterY = rect.top + rect.height / 2;

      const dx = tileCenterX - mouseX;
      const dy = tileCenterY - mouseY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < CONFIG.cursor.radius) {
        applyRepulsion(tile, index, dx, dy, distance);
      } else {
        returnToRest(tile, index);
      }
    });
  }

  function applyRepulsion(tile, index, dx, dy, distance) {
    const personality = tilePersonalities[index];
    if (!personality) return;

    // Intensity based on distance (closer = stronger)
    const intensity = 1 - (distance / CONFIG.cursor.radius);
    const easedIntensity = easeOutQuad(intensity);

    // Calculate repulsion direction (away from cursor)
    const angle = Math.atan2(dy, dx);
    const translateX = Math.cos(angle) * CONFIG.cursor.maxTranslate * easedIntensity;
    const translateY = Math.sin(angle) * CONFIG.cursor.maxTranslate * easedIntensity;

    // Apply personality-based transformations (no opacity/scale - CSS breathing handles those)
    const rotateX = personality.rotateX * easedIntensity * (dy > 0 ? 1 : -1);
    const rotateY = personality.rotateY * easedIntensity * (dx > 0 ? -1 : 1);
    const rotateZ = personality.rotateZ * easedIntensity * (Math.random() > 0.5 ? 1 : -1);

    // Mark tile as being interacted with
    tile.dataset.atRest = 'false';

    // Cancel any existing animation on this tile
    const existingAnim = tileAnimations.get(tile);
    if (existingAnim && existingAnim.pause) {
      existingAnim.pause();
    }

    // Apply with anime.js for smooth animation
    const anim = animate(tile, {
      translateX: translateX,
      translateY: translateY,
      rotateX: rotateX,
      rotateY: rotateY,
      rotateZ: rotateZ,
      duration: 150,
      ease: 'outQuad'
    });
    tileAnimations.set(tile, anim);
  }

  function returnToRest(tile, index) {
    const personality = tilePersonalities[index];
    if (!personality) return;

    // Check if tile is already at rest
    if (tile.dataset.atRest === 'true') return;

    tile.dataset.atRest = 'true';

    animate(tile, {
      translateX: 0,
      translateY: 0,
      rotateX: 0,
      rotateY: 0,
      rotateZ: 0,
      duration: CONFIG.cursor.returnDuration,
      ease: 'outElastic(1, 0.5)'
    });
  }

  function resetAllTiles() {
    tiles.forEach((tile, index) => {
      returnToRest(tile, index);
    });
  }

  function easeOutQuad(t) {
    return t * (2 - t);
  }

  // ============================================
  // Initialization
  // ============================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
