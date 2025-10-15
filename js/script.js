document.addEventListener("DOMContentLoaded", function () {
  const navLink = document.querySelector("nav a:first-of-type");

  const updateLinkText = () => {
    if (window.innerWidth <= 576) {
      navLink.textContent = "mkleyn";
    } else {
      navLink.textContent = "mkleyn.com";
    }
  };

  window.addEventListener("resize", updateLinkText);
  updateLinkText();

  // Mode toggle functionality
  const modeToggle = document.getElementById('mode-toggle');
  const navLinks = document.querySelectorAll('.nav-link');

  // Get current mode from localStorage or default to 'work'
  let currentMode = localStorage.getItem('siteMode') || 'work';

  // Link text for each mode
  const linkText = {
    work: ['projects', 'blog', 'contact'],
    life: ['music', 'books', 'photos']
  };

  // Load toggle animation frames
  let toggleFrames = null;
  let isAnimating = false;

  fetch('./assets/ascii-button.json')
    .then(r => r.json())
    .then(frames => {
      toggleFrames = frames;
      // Set initial frame (life = first frame, work = last frame)
      if (modeToggle && toggleFrames.length > 0) {
        if (currentMode === 'work') {
          modeToggle.textContent = toggleFrames[toggleFrames.length - 1].join('\n');
        } else {
          modeToggle.textContent = toggleFrames[0].join('\n');
        }
      }
    })
    .catch(error => {
      console.error('Failed to load toggle animation:', error);
    });

  // Animate toggle icon
  function animateToggleIcon(mode) {
    if (!toggleFrames || !modeToggle || isAnimating) return;

    isAnimating = true;
    let currentFrame;
    let frameIncrement;
    let endFrame;

    if (mode === 'life') {
      // Play backward: computer → yoga (last frame to first frame)
      currentFrame = toggleFrames.length - 1;
      frameIncrement = -3;
      endFrame = 0;
    } else {
      // Play forward: yoga → computer (first frame to last frame)
      currentFrame = 0;
      frameIncrement = 3; 
      endFrame = toggleFrames.length - 1;
    }

    const animationInterval = setInterval(() => {
      modeToggle.textContent = toggleFrames[currentFrame].join('\n');

      // Check if we've passed the end frame
      if ((frameIncrement > 0 && currentFrame >= endFrame) ||
          (frameIncrement < 0 && currentFrame <= endFrame)) {
        clearInterval(animationInterval);
        isAnimating = false;
      } else {
        currentFrame += frameIncrement;
        // Clamp to valid range
        if (frameIncrement > 0 && currentFrame > endFrame) currentFrame = endFrame;
        if (frameIncrement < 0 && currentFrame < endFrame) currentFrame = endFrame;
      }
    }, 10); // 10ms per frame for very fast animation
  }

  // Update links based on mode
  function updateMode(mode, skipAnimation = false) {
    currentMode = mode;
    localStorage.setItem('siteMode', mode);

    // Animate the toggle icon
    if (!skipAnimation) {
      animateToggleIcon(mode);

      // Fade out links
      navLinks.forEach(link => {
        link.style.opacity = '0';
      });

      // Wait for fade out to complete, then change text and fade back in
      setTimeout(() => {
        navLinks.forEach((link, index) => {
          if (mode === 'work') {
            link.href = link.dataset.work;
            link.textContent = linkText.work[index];
          } else {
            link.href = link.dataset.life;
            link.textContent = linkText.life[index];
          }
        });

        // Fade back in after text change
        requestAnimationFrame(() => {
          navLinks.forEach(link => {
            link.style.opacity = '1';
          });
        });
      }, 350);
    } else {
      // Initial load - no animation
      navLinks.forEach((link, index) => {
        if (mode === 'work') {
          link.href = link.dataset.work;
          link.textContent = linkText.work[index];
        } else {
          link.href = link.dataset.life;
          link.textContent = linkText.life[index];
        }
      });
    }
  }

  // Set initial mode (skip animation on page load)
  updateMode(currentMode, true);

  // Toggle mode on button click
  const toggleWrapper = document.querySelector('.toggle-wrapper');
  if (toggleWrapper) {
    toggleWrapper.addEventListener('click', () => {
      const newMode = currentMode === 'work' ? 'life' : 'work';
      updateMode(newMode);
    });
  }

  // Simplified navigation handling
  document.querySelectorAll('nav a').forEach(link => {
    link.addEventListener('click', (e) => {
      if (link.getAttribute('href').startsWith('http')) return; // Don't handle external links
      e.preventDefault();
      window.location = link.href;
    });
  });

  // Generate gradient sidebar cells dynamically
  const gradientSidebar = document.querySelector('.gradient-sidebar');
  if (gradientSidebar) {
    // Generate 100 cells for mobile (5 rows × 20 cols), desktop only uses first 60
    for (let i = 0; i < 100; i++) {
      const sidebarRow = document.createElement('div');
      sidebarRow.className = 'sidebar-row';
      gradientSidebar.appendChild(sidebarRow);
    }
  }

  // Animated sidebar - Star Trek console style with traveling light (3-column)
  const sidebarRows = document.querySelectorAll('.sidebar-row');
  const numCols = 3;
  const numRows = sidebarRows.length / numCols; // 20 rows with 3 columns

  // Create animation sequence: left-to-right, bottom-to-top
  // Grid flows by rows: [0,1,2] [3,4,5] [6,7,8] ... [57,58,59]
  const animationSequence = [];
  for (let row = numRows - 1; row >= 0; row--) {
    const leftIndex = row * numCols;      // Left cell
    const middleIndex = row * numCols + 1; // Middle cell
    const rightIndex = row * numCols + 2;  // Right cell
    animationSequence.push(leftIndex);
    animationSequence.push(middleIndex);
    animationSequence.push(rightIndex);
  }

  let currentStep = 0;
  let direction = 1; // 1 for going up, -1 for going down

  function clearAllLit() {
    sidebarRows.forEach(row => {
      row.classList.remove('lit', 'lit-1', 'lit-2');
    });
  }

  function lightUpPosition(step) {
    clearAllLit();

    const currentIndex = animationSequence[step];
    const prevIndex1 = step - direction >= 0 && step - direction < animationSequence.length ? animationSequence[step - direction] : -1;
    const prevIndex2 = step - direction * 2 >= 0 && step - direction * 2 < animationSequence.length ? animationSequence[step - direction * 2] : -1;

    // Light up current position (n) - brightest
    if (currentIndex >= 0 && currentIndex < sidebarRows.length) {
      sidebarRows[currentIndex].classList.add('lit');
    }

    // Light up previous positions with diminishing brightness
    if (prevIndex1 >= 0 && prevIndex1 < sidebarRows.length) {
      sidebarRows[prevIndex1].classList.add('lit-1');
    }

    if (prevIndex2 >= 0 && prevIndex2 < sidebarRows.length) {
      sidebarRows[prevIndex2].classList.add('lit-2');
    }
  }

  function animateSidebar() {
    lightUpPosition(currentStep);
    currentStep += direction;

    // Reverse direction at the ends
    if (currentStep >= animationSequence.length) {
      currentStep = animationSequence.length - 1;
      direction = -1;
    } else if (currentStep < 0) {
      currentStep = 0;
      direction = 1;
    }
  }

  // Run animation on page load
  setTimeout(() => {
    lightUpPosition(0);
    // Continue animation
    setInterval(animateSidebar, 100); // Move every 100ms
  }, 300);

  // Random cell lighting
  function randomlyLightCell() {
    // Pick a random cell
    const randomIndex = Math.floor(Math.random() * sidebarRows.length);
    const cell = sidebarRows[randomIndex];

    // Temporarily add a random light class
    cell.classList.add('random-lit');

    // Remove it after a brief moment
    setTimeout(() => {
      cell.classList.remove('random-lit');
    }, 300 + Math.random() * 400); // Random duration between 300-700ms
  }

  // Trigger random lights periodically
  setInterval(() => {
    // Randomly decide whether to light a cell (50% chance)
    if (Math.random() > 0.5) {
      randomlyLightCell();
    }
  }, 400); // Check every 400ms

  // ============================================
  // Occasional Pattern Animations
  // ============================================

  // Ripple effect - emanates from a random cell
  function triggerRipple() {
    const centerIndex = Math.floor(Math.random() * 60); // Only use first 60 cells for desktop
    const centerRow = Math.floor(centerIndex / numCols);
    const centerCol = centerIndex % numCols;

    // Calculate distance from center for each cell
    const cellsWithDistance = [];
    for (let i = 0; i < 60; i++) {
      const row = Math.floor(i / numCols);
      const col = i % numCols;
      const distance = Math.sqrt(Math.pow(row - centerRow, 2) + Math.pow(col - centerCol, 2));
      cellsWithDistance.push({ index: i, distance });
    }

    // Sort by distance
    cellsWithDistance.sort((a, b) => a.distance - b.distance);

    // Animate ripple
    cellsWithDistance.forEach((cell, idx) => {
      setTimeout(() => {
        if (cell.index < sidebarRows.length) {
          sidebarRows[cell.index].classList.add('random-lit');
          setTimeout(() => {
            sidebarRows[cell.index].classList.remove('random-lit');
          }, 200);
        }
      }, idx * 30);
    });
  }

  // Random path tracer - zooms through random cells
  function triggerRandomTracer() {
    const pathLength = 15 + Math.floor(Math.random() * 10); // 15-25 cells
    const path = [];

    // Generate random path
    let currentIndex = Math.floor(Math.random() * 60);
    path.push(currentIndex);

    for (let i = 1; i < pathLength; i++) {
      const currentRow = Math.floor(currentIndex / numCols);
      const currentCol = currentIndex % numCols;

      // Move to adjacent cell (up, down, left, right)
      const moves = [];
      if (currentRow > 0) moves.push(currentIndex - numCols); // up
      if (currentRow < numRows - 1) moves.push(currentIndex + numCols); // down
      if (currentCol > 0) moves.push(currentIndex - 1); // left
      if (currentCol < numCols - 1) moves.push(currentIndex + 1); // right

      currentIndex = moves[Math.floor(Math.random() * moves.length)];
      path.push(currentIndex);
    }

    // Animate tracer along path
    path.forEach((cellIndex, idx) => {
      setTimeout(() => {
        if (cellIndex < sidebarRows.length) {
          sidebarRows[cellIndex].classList.add('random-lit');
          setTimeout(() => {
            sidebarRows[cellIndex].classList.remove('random-lit');
          }, 150);
        }
      }, idx * 50);
    });
  }

  // Trigger occasional patterns
  function triggerRandomPattern() {
    const patterns = [triggerRipple, triggerRandomTracer];
    const randomPattern = patterns[Math.floor(Math.random() * patterns.length)];
    randomPattern();
  }

  // Run patterns every 15-25 seconds
  setInterval(() => {
    triggerRandomPattern();
  }, 15000 + Math.random() * 10000); // Random interval between 15-25 seconds

  // ============================================
  // ASCII Animation System - Cyclic
  // ============================================

  const asciiLayer = document.querySelector('.ascii-layer');
  if (!asciiLayer) return; // Skip if no ASCII layer on page

  let animationFrames = {
    jellyfish: null,
    butterfly: null,
    deer: null,
    moonwalk: null,
    horse: null,
    whale: null
  };

  // Load all animation frames
  Promise.all([
    fetch('./assets/jellyfish-ascii-frames.json').then(r => r.json()),
    fetch('./assets/ascii-frames-butterfly.json').then(r => r.json()),
    fetch('./assets/ascii-frames-deer.json').then(r => r.json()),
    fetch('./assets/ascii-frames-moonwalk.json').then(r => r.json()),
    fetch('./assets/ascii-frames-horse.json').then(r => r.json()),
    fetch('./assets/ascii-frames-whale.json').then(r => r.json())
  ])
    .then(([jellyfish, butterfly, deer, moonwalk, horse, whale]) => {
      animationFrames.jellyfish = jellyfish;
      animationFrames.butterfly = butterfly;
      animationFrames.deer = deer;
      animationFrames.moonwalk = moonwalk;
      animationFrames.horse = horse;
      animationFrames.whale = whale;
      console.log('Loaded all ASCII animations');

      // Start the animation cycle
      startAnimationCycle();
    })
    .catch(error => {
      console.error('Failed to load ASCII animations:', error);
    });

  // Fixed positioning
  function getFixedPosition(top, side = 'right', offset = 10) {
    if (side === 'left') {
      return {
        left: `${offset}vw`,
        top: `${top}vh`
      };
    } else {
      return {
        right: `${offset}vw`,
        top: `${top}vh`
      };
    }
  }

  function createASCIIElement(position, scale = 1.0) {
    const pre = document.createElement('pre');
    pre.className = 'ascii-art';

    // Apply position
    Object.keys(position).forEach(key => {
      pre.style[key] = position[key];
    });

    // Apply scale
    pre.style.transform = `scale(${scale})`;
    pre.style.transformOrigin = 'center';

    return pre;
  }

  // Generic animation function for any ASCII art
  function animateASCII(frames, scale, frameSpeed, duration, position) {
    return new Promise((resolve) => {
      if (!frames) {
        resolve();
        return;
      }

      // Create ASCII element
      const asciiElement = createASCIIElement(position, scale);
      asciiLayer.appendChild(asciiElement);

      // Sample frames to reduce load (use every 3rd frame)
      const sampledFrames = frames.filter((_, index) => index % 3 === 0);

      let currentFrame = 0;
      let frameDirection = 1; // 1 = forward, -1 = backward
      let animationInterval;

      // Fade in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          asciiElement.classList.add('active');
        });
      });

      // Start frame cycling
      animationInterval = setInterval(() => {
        asciiElement.textContent = sampledFrames[currentFrame].join('\n');

        currentFrame += frameDirection;

        // Reverse direction at the ends
        if (currentFrame >= sampledFrames.length - 1) {
          frameDirection = -1;
        } else if (currentFrame <= 0) {
          frameDirection = 1;
        }
      }, frameSpeed);

      // Duration: show for specified time
      setTimeout(() => {
        // Fade out
        asciiElement.classList.remove('active');
        asciiElement.classList.add('fading');

        // Clean up after fade completes
        setTimeout(() => {
          clearInterval(animationInterval);
          asciiLayer.removeChild(asciiElement);
          resolve();
        }, 1500); // Match CSS transition duration
      }, duration);
    });
  }

  // Show three jellyfish together (right side) - 10 seconds
  async function showJellyfishGroup() {
    const jellyfishPromises = [
      animateASCII(animationFrames.jellyfish, 1.0, 200, 10000, getFixedPosition(0, 'right', 15)),
      animateASCII(animationFrames.jellyfish, 0.7, 220, 10000, getFixedPosition(30, 'right', 10)),
      animateASCII(animationFrames.jellyfish, 0.5, 250, 10000, getFixedPosition(55, 'right', 10)),
      animateASCII(animationFrames.jellyfish, 0.2, 250, 10000, getFixedPosition(55, 'right', 0)),
      animateASCII(animationFrames.jellyfish, 0.3, 250, 10000, getFixedPosition(5, 'right', 0))
    ];

    // Wait for all jellyfish to complete
    await Promise.all(jellyfishPromises);
  }

  // Show single butterfly (left side) - 12 seconds
  async function showButterfly() {
    await animateASCII(animationFrames.butterfly, 1.4, 200, 12000, getFixedPosition(20, 'left', 10));
  }

  // Show single deer (right side) - 8 seconds
  async function showDeer() {
    await animateASCII(animationFrames.deer, 1.0, 200, 8000, getFixedPosition(55, 'right', 0));
  }

  // Show single moonwalk (left side) - 10 seconds
  async function showMoonwalk() {
    await animateASCII(animationFrames.moonwalk, 1.0, 200, 10000, getFixedPosition(10, 'left', 0));
  }

  // Show single horse (right side) - 8 seconds
  async function showHorse() {
    await animateASCII(animationFrames.horse, 1.0, 200, 8000, getFixedPosition(0, 'right', 0));
  }

  // Show single whale (left side) - 10 seconds
  async function showWhale() {
    await animateASCII(animationFrames.whale, 1.0, 200, 10000, getFixedPosition(35, 'left', 10));
  }

  // Right side animation cycle
  async function rightSideAnimationCycle() {
    while (true) {
      await showJellyfishGroup();
      await new Promise(resolve => setTimeout(resolve, 2000)); // Pause between animations

      await showDeer();
      await new Promise(resolve => setTimeout(resolve, 2000));

      await showHorse();
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Cycle repeats
    }
  }

  // Left side animation cycle
  async function leftSideAnimationCycle() {
    while (true) {
      await showButterfly();
      await new Promise(resolve => setTimeout(resolve, 1500)); // Pause between animations

      await showMoonwalk();
      await new Promise(resolve => setTimeout(resolve, 1500));

      await showWhale();
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Cycle repeats
    }
  }

  // Start both animation cycles independently with staggered timing
  function startAnimationCycle() {
    rightSideAnimationCycle(); // Start immediately

    // Start left side 4 seconds later
    setTimeout(() => {
      leftSideAnimationCycle();
    }, 4000);
  }
});
