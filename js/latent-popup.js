/**
 * Latent Popup System
 *
 * Text parts like water to reveal content emerging from beneath.
 * Uses anime.js v4 splitText for proper text handling.
 */

(function () {
  'use strict';

  // Destructure anime.js v4 methods
  // stagger: "creates sequential effects by distributing values progressively across multiple targets"
  // - https://animejs.com/documentation/utilities/stagger
  const { animate, splitText, stagger } = anime;

  const CONFIG = {
    scatterRadius: 150,      // How far from popup center to affect characters
    scatterStrength: 80,     // Max displacement distance
    hoverDelay: 400,         // ms before showing popup
    charReturnDuration: 800, // ms for characters to return
    charReturnDelay: 200     // ms delay before characters start returning
  };

  let textSplitter = null;
  let activePopup = null;
  let popupElement = null;
  let hoverTimeout = null;
  let scatterAnimation = null; // Track the animation for cleanup

  /**
   * Initialize the system
   */
  function init() {
    // Create the popup container
    createPopupElement();

    // Split text using anime.js splitText
    splitMainText();

    // Setup popup triggers
    setupPopupLinks();

    // Recache on resize
    window.addEventListener('resize', debounce(() => {
      if (textSplitter) {
        textSplitter.refresh();
      }
    }, 250));

    console.log('Latent Popup System initialized with anime.js splitText');
  }

  /**
   * Split all text in main content into character spans
   */
  function splitMainText() {
    const main = document.querySelector('main');
    if (!main) return;

    // Get all text-containing elements
    const textElements = main.querySelectorAll('p, h1, h2, h3, li');

    textElements.forEach(element => {
      // Elements with popup links need manual splitting to preserve the links
      if (element.querySelector('a[data-popup]')) {
        splitElementExcludingLinks(element);
      } else {
        // Use anime.js splitText with our class name
        try {
          const split = splitText(element, {
            chars: { class: 'latent-char' },
            words: { class: 'latent-word' }
          });
          element._textSplitter = split;
        } catch (e) {
          console.warn('Could not split element:', element, e);
          // Fallback to manual splitting
          splitElementExcludingLinks(element);
        }
      }
    });
  }

  /**
   * Split an element but preserve popup links intact
   */
  function splitElementExcludingLinks(element) {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          // Skip text nodes inside popup links
          if (node.parentElement && node.parentElement.closest('a[data-popup]')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      },
      false
    );

    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach(textNode => {
      const text = textNode.textContent;
      if (!text.trim()) return;

      const fragment = document.createDocumentFragment();
      const tokens = text.split(/(\s+)/);

      tokens.forEach(token => {
        if (/^\s+$/.test(token)) {
          fragment.appendChild(document.createTextNode(token));
        } else if (token.length > 0) {
          const wordSpan = document.createElement('span');
          wordSpan.className = 'latent-word';
          wordSpan.style.whiteSpace = 'nowrap';
          wordSpan.style.display = 'inline';

          for (let i = 0; i < token.length; i++) {
            const charSpan = document.createElement('span');
            charSpan.className = 'latent-char';
            charSpan.textContent = token[i];
            wordSpan.appendChild(charSpan);
          }

          fragment.appendChild(wordSpan);
        }
      });

      textNode.parentNode.replaceChild(fragment, textNode);
    });
  }

  /**
   * Create the popup element (hidden initially)
   */
  function createPopupElement() {
    popupElement = document.createElement('div');
    popupElement.className = 'latent-popup';
    popupElement.innerHTML = '<div class="latent-popup-content"></div>';
    document.body.appendChild(popupElement);
  }

  /**
   * Setup hover listeners on popup links
   */
  function setupPopupLinks() {
    const links = document.querySelectorAll('a[data-popup]');

    links.forEach(link => {
      link.addEventListener('mouseenter', (e) => {
        clearTimeout(hoverTimeout);

        hoverTimeout = setTimeout(() => {
          showPopup(link);
        }, CONFIG.hoverDelay);
      });

      link.addEventListener('mouseleave', () => {
        clearTimeout(hoverTimeout);

        hoverTimeout = setTimeout(() => {
          if (activePopup && popupElement && !popupElement.matches(':hover')) {
            hidePopup();
          }
        }, 300);
      });
    });

    // Keep popup open when hovering over it
    popupElement.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimeout);
    });

    popupElement.addEventListener('mouseleave', () => {
      hoverTimeout = setTimeout(() => {
        hidePopup();
      }, 300);
    });
  }

  /**
   * Get the bounding rect of the active popup link (for exclusion zone)
   */
  function getActiveLinkRect() {
    if (!activePopup) return null;
    return activePopup.getBoundingClientRect();
  }

  /**
   * Show popup and scatter characters
   */
  async function showPopup(link) {
    if (activePopup === link) return;

    activePopup = link;
    const contentPath = link.dataset.popup;
    const contentType = link.dataset.popupType || 'html';

    await loadContent(contentPath, contentType);
    positionPopup(link);
    popupElement.classList.add('visible');

    // Reveal the popup content from center outward
    // Documentation: anime.js can animate "any CSS numerical properties"
    // - https://animejs.com/documentation/animation/animatable-properties/css-properties
    // clip-path: circle() expands from 0% to reveal the full image
    revealPopupContent();

    scatterCharacters();
  }

  /**
   * Animate the popup content revealing from center
   */
  function revealPopupContent() {
    const content = popupElement.querySelector('.latent-popup-content');
    if (!content) return;

    // Reset to hidden state
    content.style.setProperty('--reveal', '0');

    // Animate the --reveal CSS variable from 0 to 1
    // Documentation: anime.js can animate CSS variables
    // - https://animejs.com/documentation/animation/animatable-properties
    // The CSS uses this variable to control a feathered gradient mask
    animate(content, {
      '--reveal': [0, 1],
      duration: 800,
      ease: 'outQuad'
    });
  }

  /**
   * Load content into the popup
   */
  async function loadContent(contentPath, contentType) {
    const contentEl = popupElement.querySelector('.latent-popup-content');

    if (contentType === 'image') {
      contentEl.innerHTML = `<img src="${contentPath}" alt="">`;
    } else if (contentType === 'html') {
      try {
        const response = await fetch(contentPath);
        const html = await response.text();
        contentEl.innerHTML = html;

        const video = contentEl.querySelector('video');
        if (video) {
          video.play().catch(() => { });
        }
      } catch (error) {
        console.error('Failed to load popup content:', error);
        contentEl.innerHTML = '<p>Failed to load content</p>';
      }
    }
  }

  /**
   * Position the popup to the side of the main content
   */
  function positionPopup(link) {
    const linkRect = link.getBoundingClientRect();
    const main = document.querySelector('main');
    const mainRect = main ? main.getBoundingClientRect() : null;

    let left, top;

    if (mainRect) {
      // Position to the right of the main content area
      left = mainRect.right - 60;
      top = linkRect.top + 80;

      // If not enough space on right, try left of main content
      if (left + 400 > window.innerWidth) {
        left = mainRect.left - 440;
      }
    } else {
      // Fallback: position relative to link
      left = linkRect.right + 40;
      top = linkRect.top - 50;
    }

    // Keep within viewport
    left = Math.max(20, Math.min(left, window.innerWidth - 420));
    top = Math.max(20, Math.min(top, window.innerHeight - 350));

    popupElement.style.left = `${left}px`;
    popupElement.style.top = `${top}px`;
  }

  /**
   * Scatter characters near the popup using anime.js
   */
  function scatterCharacters() {
    const popupRect = popupElement.getBoundingClientRect();
    const linkRect = activePopup ? activePopup.getBoundingClientRect() : null;
    const linkSafeZone = 30;
    const chars = document.querySelectorAll('.latent-char');

    // Collect characters that should scatter with their computed values
    const targets = [];
    const scatterData = [];

    chars.forEach(char => {
      const rect = char.getBoundingClientRect();
      const charX = rect.left + rect.width / 2;
      const charY = rect.top + rect.height / 2 - 90;

      // Skip characters too close to the link
      if (linkRect) {
        const inLinkZone = charX >= (linkRect.left - linkSafeZone) &&
          charX <= (linkRect.right + linkSafeZone) &&
          charY >= (linkRect.top - linkSafeZone) &&
          charY <= (linkRect.bottom + linkSafeZone);
        if (inLinkZone) return;
      }

      // Distance to nearest edge of popup
      const closestX = Math.max(popupRect.left, Math.min(charX, popupRect.right));
      const closestY = Math.max(popupRect.top, Math.min(charY, popupRect.bottom));
      const dx = charX - closestX;
      const dy = charY - closestY;
      const distanceFromEdge = Math.sqrt(dx * dx + dy * dy);

      const isInside = charX >= popupRect.left && charX <= popupRect.right &&
        charY >= popupRect.top && charY <= popupRect.bottom;

      if (isInside || distanceFromEdge < CONFIG.scatterRadius) {
        const intensity = isInside ? 1 : 1 - (distanceFromEdge / CONFIG.scatterRadius);

        // Calculate repulsion
        let repulseX, repulseY;
        if (isInside) {
          const toLeft = charX - popupRect.left;
          const toRight = popupRect.right - charX;
          const toTop = charY - popupRect.top;
          const toBottom = popupRect.bottom - charY;
          const minH = Math.min(toLeft, toRight);
          const minV = Math.min(toTop, toBottom);

          if (minH < minV) {
            repulseX = toLeft < toRight ? -CONFIG.scatterStrength : CONFIG.scatterStrength;
            repulseY = (Math.random() - 0.5) * CONFIG.scatterStrength * 0.5;
          } else {
            repulseY = toTop < toBottom ? -CONFIG.scatterStrength : CONFIG.scatterStrength;
            repulseX = (Math.random() - 0.5) * CONFIG.scatterStrength * 0.5;
          }
        } else {
          const angle = Math.atan2(dy, dx);
          repulseX = Math.cos(angle) * CONFIG.scatterStrength * intensity;
          repulseY = Math.sin(angle) * CONFIG.scatterStrength * intensity;
        }

        repulseX += (Math.random() - 0.5) * 20;
        repulseY += (Math.random() - 0.5) * 20;

        const rotateZ = (Math.random() - 0.5) * 15 * intensity;

        char.dataset.floating = 'true';
        targets.push(char);
        scatterData.push({
          x: repulseX,
          y: repulseY,
          rotate: rotateZ,
          // Add drift variation for the oscillation
          driftX: (Math.random() - 0.5) * 16,
          driftY: (Math.random() - 0.5) * 16,
          driftRotate: (Math.random() - 0.5) * 10
        });
      }
    });

    if (targets.length === 0) return;

    // Use anime.js with loop and alternate for continuous floating effect
    // Documentation: "loop: true" creates infinite loops
    // - https://animejs.com/documentation/timer/timer-playback-settings/loop
    // Documentation: "alternate: true" reverses direction each cycle for yo-yo effect
    // - https://animejs.com/documentation/timer/timer-playback-settings/alternate
    // Documentation: stagger() "creates sequential effects by distributing values progressively"
    // - https://animejs.com/documentation/utilities/stagger
    scatterAnimation = animate(targets, {
      // Function-based values let us set unique targets per element
      // Each character gets its computed repulsion + drift as the oscillation range
      translateX: (el, i) => [0, scatterData[i].x + scatterData[i].driftX, scatterData[i].x - scatterData[i].driftX],
      translateY: (el, i) => [0, scatterData[i].y + scatterData[i].driftY, scatterData[i].y - scatterData[i].driftY],
      rotate: (el, i) => [0, scatterData[i].rotate + scatterData[i].driftRotate, scatterData[i].rotate - scatterData[i].driftRotate],
      opacity: [1, 0.5, 0.7],
      duration: 200,
      // loop: true creates infinite repetition
      loop: false,
      // alternate: true makes it yo-yo back and forth smoothly
      alternate: true,
      // stagger offsets each element's start time for natural variation
      delay: stagger(5, { from: 'center' }),
      ease: spring({
        bounce: 0.65,
        duration: 400
      })
    });
  }

  /**
   * Stop the scatter animation
   */
  function stopScatterAnimation() {
    if (scatterAnimation) {
      scatterAnimation.pause();
      scatterAnimation = null;
    }
  }

  /**
   * Hide popup and return characters
   */
  function hidePopup() {
    if (!activePopup) return;

    activePopup = null;

    // Swipe the popup content off, then clean up
    hidePopupContent(() => {
      popupElement.classList.remove('visible');
      returnCharacters();
    });
  }

  /**
   * Animate the popup content swiping off to the right
   */
  function hidePopupContent(onComplete) {
    const content = popupElement.querySelector('.latent-popup-content');
    if (!content) {
      if (onComplete) onComplete();
      return;
    }

    // Switch to swipe mask mode
    content.classList.add('swiping');
    content.style.setProperty('--swipe', '0');

    // Swipe from left to right by animating --swipe from 0 to 1
    // Documentation: onComplete callback fires when animation finishes
    // - https://animejs.com/documentation/animation/animation-callbacks
    animate(content, {
      '--swipe': [0, 1],
      duration: 500,
      ease: 'inOutQuad',
      onComplete: () => {
        // Reset reveal to hidden before removing swipe class to prevent flash
        content.style.setProperty('--reveal', '0');
        content.classList.remove('swiping');
        if (onComplete) onComplete();
      }
    });
  }

  /**
   * Return all floating characters to their original positions
   */
  function returnCharacters() {
    // Stop the looping scatter animation
    stopScatterAnimation();

    const chars = document.querySelectorAll('.latent-char[data-floating]');
    if (chars.length === 0) return;

    // Animate all floating chars back to origin
    // Documentation: ease 'outElastic' creates a bouncy return effect
    animate(chars, {
      translateX: 0,
      translateY: 0,
      rotate: 0,
      opacity: 1,
      duration: CONFIG.charReturnDuration,
      // stagger the return for a wave-like effect
      delay: stagger(10, { from: 'center' }),
      ease: 'outElastic(1, 0.6)',
      onComplete: () => {
        // Clean up floating data attribute
        chars.forEach(char => delete char.dataset.floating);
      }
    });
  }

  /**
   * Debounce helper
   */
  function debounce(fn, delay) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
