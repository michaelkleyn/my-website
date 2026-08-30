document.addEventListener("DOMContentLoaded", function () {
  // ============================================
  // Text Load-in Animation
  // ============================================

  function wrapWordsInSpans(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];

    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach(textNode => {
      const text = textNode.textContent;
      if (!text.trim()) return;

      const fragment = document.createDocumentFragment();
      const words = text.split(/(\s+)/);

      words.forEach(word => {
        if (word.match(/^\s+$/)) {
          // Whitespace - add a space element
          const space = document.createElement('span');
          space.className = 'word-space';
          fragment.appendChild(space);
        } else if (word) {
          // Word - wrap in span
          const span = document.createElement('span');
          span.className = 'word';
          span.textContent = word;
          fragment.appendChild(span);
        }
      });

      textNode.parentNode.replaceChild(fragment, textNode);
    });
  }

  // Process all animate-text containers
  const animateContainers = document.querySelectorAll('.animate-text');
  animateContainers.forEach(container => {
    // Process h1, p, and i elements
    const elements = container.querySelectorAll('h1, p, i');
    elements.forEach(el => wrapWordsInSpans(el));
  });

  // Animate words with stagger
  const allWords = document.querySelectorAll('.animate-text .word');
  if (allWords.length > 0) {
    anime({
      targets: allWords,
      opacity: [0, 1],
      translateY: [20, 0],
      easing: 'easeOutCubic',
      duration: 600,
      delay: anime.stagger(15, { start: 100 })
    });
  }

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

  // Desync the drifting gas gradient on each inline prose link + mirror
  // textContent into data-text so the ::before/::after pseudos can render
  // a blurred text-clipped copy (the feathered "bubble letter" glow).
  document.querySelectorAll('main p a').forEach(link => {
    link.setAttribute('data-text', link.textContent);
    const dur1 = 14 + Math.random() * 12;    // 14–26s
    const dur2 = 9 + Math.random() * 9;      // 9–18s
    const delay1 = -(Math.random() * dur1);  // start mid-cycle
    const delay2 = -(Math.random() * dur2);
    const dir1 = Math.random() < 0.5 ? 'normal' : 'reverse';
    const dir2 = Math.random() < 0.5 ? 'normal' : 'reverse';
    link.style.setProperty('--gas-duration-1', `${dur1.toFixed(2)}s`);
    link.style.setProperty('--gas-duration-2', `${dur2.toFixed(2)}s`);
    link.style.setProperty('--gas-delay-1', `${delay1.toFixed(2)}s`);
    link.style.setProperty('--gas-delay-2', `${delay2.toFixed(2)}s`);
    link.style.setProperty('--gas-direction-1', dir1);
    link.style.setProperty('--gas-direction-2', dir2);

    // Random pulse scheduler — each link pulses brighter/more opaque on
    // its own irregular cadence. Recurses so the gaps stay random forever.
    const schedulePulse = () => {
      const gap = 5000 + Math.random() * 12000;    // 5–17s between pulses
      const hold = 1100 + Math.random() * 900;      // 1.1–2.0s at peak
      setTimeout(() => {
        link.classList.add('pulsing');
        setTimeout(() => {
          link.classList.remove('pulsing');
          schedulePulse();
        }, hold);
      }, gap);
    };
    // Stagger the first pulse so links don't all wake up together
    setTimeout(schedulePulse, Math.random() * 8000);
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

  // Old sidebar animation disabled - now using sidebar-latent.js

  // ============================================
  // ASCII Animation System - Cyclic
  // ============================================

  const asciiLayer = document.querySelector('.ascii-layer');
  if (!asciiLayer) return; // Skip if no ASCII layer on page
  // The layout compositor (scene-renderer.js) now owns ASCII creatures as scene
  // nodes (kind:'ascii'), so it can place/size/recolor them. Stand down here to
  // avoid double-rendering into .ascii-layer.
  if (window.__compositorAscii) return;

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

  // Show single butterfly (right side) - 12 seconds
  async function showButterfly() {
    await animateASCII(animationFrames.butterfly, 1.4, 200, 12000, getFixedPosition(20, 'right', 15));
  }

  // Show single deer (right side) - 8 seconds
  async function showDeer() {
    await animateASCII(animationFrames.deer, 1.0, 200, 8000, getFixedPosition(55, 'right', 0));
  }

  // Show single moonwalk (right side) - 10 seconds
  async function showMoonwalk() {
    await animateASCII(animationFrames.moonwalk, 1.0, 200, 10000, getFixedPosition(10, 'right', 5));
  }

  // Show single horse (right side) - 8 seconds
  async function showHorse() {
    await animateASCII(animationFrames.horse, 1.0, 200, 8000, getFixedPosition(0, 'right', 0));
  }

  // Show single whale (right side) - 10 seconds
  async function showWhale() {
    await animateASCII(animationFrames.whale, 1.0, 200, 10000, getFixedPosition(35, 'right', 12));
  }

  // Unified right-side animation cycle — all animations play sequentially on the right
  async function rightSideAnimationCycle() {
    while (true) {
      await showJellyfishGroup();
      await new Promise(resolve => setTimeout(resolve, 2000));

      await showButterfly();
      await new Promise(resolve => setTimeout(resolve, 2000));

      await showDeer();
      await new Promise(resolve => setTimeout(resolve, 2000));

      await showMoonwalk();
      await new Promise(resolve => setTimeout(resolve, 2000));

      await showHorse();
      await new Promise(resolve => setTimeout(resolve, 2000));

      await showWhale();
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  function startAnimationCycle() {
    rightSideAnimationCycle();
  }
});
