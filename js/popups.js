/**
 * Advanced Popup System
 * Features: Hover-triggered popups, draggable windows, inset mode
 * Inspired by gwern.net's popup system
 */

class PopupManager {
  constructor() {
    this.popups = new Map(); // Track active popups
    this.nextPopupId = 1;
    this.zIndexCounter = 10000;
    this.insetPopup = null; // Track which popup is in inset mode

    this.init();
  }

  init() {
    // Find all links with popup data
    this.setupPopupLinks();

    // Handle escape key to close popups
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeAllPopups();
      }
    });
  }

  setupPopupLinks() {
    // Find all links with data-popup attribute
    const links = document.querySelectorAll('a[data-popup]');

    links.forEach(link => {
      let showTimeout;
      let hideTimeout;

      // Show popup on hover (with delay)
      link.addEventListener('mouseenter', (e) => {
        // Clear any pending hide timeout
        clearTimeout(hideTimeout);

        showTimeout = setTimeout(() => {
          const popup = this.showPopup(link, e);
          if (popup) {
            // Store reference to link for this popup
            const popupData = this.findPopupByContent(link.dataset.popup);
            if (popupData) {
              popupData.triggerLink = link;
            }
          }
        }, 300); // 300ms delay before showing
      });

      // Start hide timer when mouse leaves link
      link.addEventListener('mouseleave', () => {
        clearTimeout(showTimeout);

        // Find the popup for this link
        const popupData = this.findPopupByContent(link.dataset.popup);
        if (popupData) {
          // Start 1-second countdown to close
          hideTimeout = setTimeout(() => {
            this.closePopup(popupData.id);
          }, 300);

          // Store the timeout so popup can cancel it
          popupData.hideTimeout = hideTimeout;
        }
      });
    });
  }

  async showPopup(link, event) {
    const popupContent = link.dataset.popup;
    const popupType = link.dataset.popupType || 'html'; // html, image, text
    const asciiPath = link.dataset.popupAscii || null;

    // Don't create duplicate popups for the same content
    const existingPopup = this.findPopupByContent(popupContent);
    if (existingPopup) {
      this.bringToFront(existingPopup.id);
      // Clear any pending hide timeout since we're re-hovering
      if (existingPopup.hideTimeout) {
        clearTimeout(existingPopup.hideTimeout);
        existingPopup.hideTimeout = null;
      }
      return existingPopup;
    }

    // Phase 1: Create popup element (hidden with loading class)
    const popupId = this.nextPopupId++;
    const popup = this.createPopupElement(popupId, asciiPath);

    // Phase 2: Add to DOM (still hidden)
    document.body.appendChild(popup);

    // Create tracking data
    const popupData = {
      id: popupId,
      element: popup,
      content: popupContent,
      contentType: popupType,
      mode: 'windowed',
      isDragging: false,
      hideTimeout: null,
      triggerLink: link
    };
    this.popups.set(popupId, popupData);

    // Phase 3: Load content completely
    await this.loadContent(popup, popupContent, popupType);

    // Phase 4: Let CSS naturally size the popup, then measure for positioning
    const dimensions = this.getPopupDimensions(popup);

    // Phase 5: Position popup using measured dimensions
    this.positionPopup(popup, link, dimensions);

    // Phase 6: Setup interactions
    this.setupPopupInteractions(popupId);
    this.setupPopupHover(popupId);

    // Phase 7: Show popup (remove loading, add visible)
    requestAnimationFrame(() => {
      popup.classList.remove('loading');
      requestAnimationFrame(() => {
        popup.classList.add('visible');
      });
    });

    return popupData;
  }

  createPopupElement(popupId, asciiPath = null) {
    const popup = document.createElement('div');
    popup.className = 'popup-window loading';
    popup.dataset.popupId = popupId;
    popup.style.zIndex = this.zIndexCounter++;

    const asciiBackground = asciiPath
      ? '<pre class="popup-ascii-background"></pre>'
      : '';

    const titleContent = asciiPath
      ? '' // No title when we have ASCII
      : '<div class="popup-title">Loading...</div>';

    popup.innerHTML = `
      ${asciiBackground}
      <div class="popup-header">
        ${titleContent}
        <div class="popup-controls">
          <button class="popup-btn popup-mode-toggle-btn" title="Toggle Mode" aria-label="Toggle between windowed and inset mode" data-mode="windowed"></button>
          <button class="popup-btn popup-close-btn" title="Close" aria-label="Close popup"></button>
        </div>
      </div>
      <div class="popup-body">
        <div class="popup-loading">Loading content...</div>
      </div>
    `;

    // Load ASCII animation if specified
    if (asciiPath) {
      this.loadASCIIAnimation(popup, asciiPath);
    }

    return popup;
  }

  async loadASCIIAnimation(popup, asciiPath) {
    try {
      const response = await fetch(asciiPath);
      if (!response.ok) {
        console.error('Failed to load ASCII animation');
        return;
      }

      const frames = await response.json();
      const asciiElement = popup.querySelector('.popup-ascii-background');

      if (!asciiElement || !frames || frames.length === 0) return;

      // Sample every 3rd frame for performance
      const sampledFrames = frames.filter((_, index) => index % 3 === 0);
      let currentFrame = 0;

      // Set initial frame
      asciiElement.textContent = sampledFrames[0].join('\n');

      const animationInterval = setInterval(() => {
        currentFrame = (currentFrame + 1) % sampledFrames.length;
        asciiElement.textContent = sampledFrames[currentFrame].join('\n');
      }, 100); // Change frame every 100ms for smooth animation

      // Store interval reference for cleanup
      popup.dataset.asciiInterval = animationInterval;

    } catch (error) {
      console.error('Error loading ASCII animation:', error);
    }
  }

  async loadContent(popup, contentPath, contentType) {
    const body = popup.querySelector('.popup-body');
    const title = popup.querySelector('.popup-title');

    try {
      if (contentType === 'image') {
        // Load image and wait for it to complete
        await new Promise((resolve, reject) => {
          const img = document.createElement('img');
          img.src = contentPath;
          img.alt = 'Popup content';

          img.onload = () => {
            body.innerHTML = '';
            // Wrap image in a container for feathering effect
            const wrapper = document.createElement('div');
            wrapper.className = 'popup-image-wrapper';
            wrapper.appendChild(img);
            body.appendChild(wrapper);
            if (title) title.textContent = 'Image';
            resolve();
          };

          img.onerror = () => {
            body.innerHTML = '<p class="popup-error">Failed to load image</p>';
            if (title) title.textContent = 'Error';
            reject(new Error('Image failed to load'));
          };
        });

      } else if (contentType === 'html') {
        // Load HTML snippet
        const response = await fetch(contentPath);
        if (!response.ok) throw new Error('Failed to load content');

        const html = await response.text();
        body.innerHTML = html;

        // Try to extract title from first heading (only if not using ASCII background)
        if (!popup.querySelector('.popup-ascii-background') && title) {
          const heading = body.querySelector('h1, h2, h3, h4');
          if (heading) {
            title.textContent = heading.textContent;
          } else {
            title.textContent = 'Content';
          }
        }

        // Wait for all images in HTML content to load and wrap them
        const images = body.querySelectorAll('img');
        if (images.length > 0) {
          await Promise.all(
            Array.from(images).map(img => {
              if (img.complete) return Promise.resolve();
              return new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = resolve; // Don't fail entire popup if one image fails
                // Timeout after 5 seconds
                setTimeout(resolve, 5000);
              });
            })
          );

          // Wrap each image in a feathering container
          images.forEach(img => {
            const wrapper = document.createElement('div');
            wrapper.className = 'popup-image-wrapper';
            img.parentNode.insertBefore(wrapper, img);
            wrapper.appendChild(img);
          });
        }

        // Wait for all videos in HTML content to load and wrap them
        const videos = body.querySelectorAll('video');
        if (videos.length > 0) {
          await Promise.all(
            Array.from(videos).map(video => {
              if (video.readyState >= 2) return Promise.resolve(); // HAVE_CURRENT_DATA or better
              return new Promise((resolve) => {
                video.onloadeddata = resolve;
                video.onerror = resolve; // Don't fail entire popup if one video fails
                // Timeout after 5 seconds
                setTimeout(resolve, 5000);
              });
            })
          );

          // Wrap each video in a feathering container
          videos.forEach(video => {
            const wrapper = document.createElement('div');
            wrapper.className = 'popup-image-wrapper';
            video.parentNode.insertBefore(wrapper, video);
            wrapper.appendChild(video);
          });
        }

      } else if (contentType === 'text') {
        // Direct text content
        body.innerHTML = `<p>${contentPath}</p>`;
        if (title) title.textContent = 'Note';
      }
    } catch (error) {
      body.innerHTML = '<p class="popup-error">Failed to load content</p>';
      if (title) title.textContent = 'Error';
      console.error('Popup content load error:', error);
    }
  }

  positionPopup(popup, element, dimensions) {
    const rect = element.getBoundingClientRect();
    const popupWidth = dimensions.width;
    const popupHeight = dimensions.height;
    const margin = 10;

    // Try to position to the right of the element
    let left = rect.right + margin;
    let preferredPosition = 'right';

    // If not enough space on right, try left
    if (left + popupWidth > window.innerWidth - margin) {
      left = rect.left - popupWidth - margin;
      preferredPosition = 'left';
    }

    // If still not enough space, center horizontally in viewport
    if (left < margin) {
      left = Math.max(margin, (window.innerWidth - popupWidth) / 2);
      preferredPosition = 'center';
    }

    // Vertically center with the element
    let top = rect.top + (rect.height / 2) - (popupHeight / 2);

    // Keep within viewport vertically
    if (top < margin) {
      top = margin;
    } else if (top + popupHeight > window.innerHeight - margin) {
      top = window.innerHeight - popupHeight - margin;
    }

    // Final boundary checks
    left = Math.max(margin, Math.min(left, window.innerWidth - popupWidth - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - popupHeight - margin));

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;

    return preferredPosition;
  }

  setupPopupInteractions(popupId) {
    const popupData = this.popups.get(popupId);
    if (!popupData) return;

    const popup = popupData.element;
    const header = popup.querySelector('.popup-header');
    const closeBtn = popup.querySelector('.popup-close-btn');
    const modeToggleBtn = popup.querySelector('.popup-mode-toggle-btn');

    // Close button
    closeBtn.addEventListener('click', () => {
      this.closePopup(popupId);
    });

    // Mode toggle button
    modeToggleBtn.addEventListener('click', () => {
      const currentMode = popupData.mode;
      const newMode = currentMode === 'windowed' ? 'inset' : 'windowed';
      this.setPopupMode(popupId, newMode);
    });

    // Bring to front on click
    popup.addEventListener('mousedown', () => {
      this.bringToFront(popupId);
    });

    // Dragging
    this.setupDragging(popupId, header);
  }

  setupPopupHover(popupId) {
    const popupData = this.popups.get(popupId);
    if (!popupData) return;

    const popup = popupData.element;

    // Cancel hide timer when mouse enters popup
    popup.addEventListener('mouseenter', () => {
      if (popupData.hideTimeout) {
        clearTimeout(popupData.hideTimeout);
        popupData.hideTimeout = null;
      }
    });

    // Start hide timer when mouse leaves popup
    popup.addEventListener('mouseleave', () => {
      // Start 1-second countdown to close
      popupData.hideTimeout = setTimeout(() => {
        this.closePopup(popupId);
      }, 1000);
    });
  }

  setupDragging(popupId, dragHandle) {
    // Placeholder - will implement in Phase 2
    const popupData = this.popups.get(popupId);
    if (!popupData) return;

    const popup = popupData.element;
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;

    dragHandle.style.cursor = 'move';

    const dragStart = (e) => {
      const popupData = this.popups.get(popupId);
      if (popupData.mode === 'inset') return; // Can't drag inset popups

      initialX = e.clientX - popup.offsetLeft;
      initialY = e.clientY - popup.offsetTop;

      if (e.target.closest('.popup-controls')) return; // Don't drag when clicking buttons

      isDragging = true;
      popup.classList.add('dragging');

      // Prevent text selection during drag
      e.preventDefault();
      document.body.style.userSelect = 'none';
    };

    const drag = (e) => {
      if (!isDragging) return;

      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;

      popup.style.left = `${currentX}px`;
      popup.style.top = `${currentY}px`;
    };

    const dragEnd = () => {
      isDragging = false;
      popup.classList.remove('dragging');

      // Re-enable text selection
      document.body.style.userSelect = '';
    };

    dragHandle.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);
  }

  setPopupMode(popupId, mode) {
    const popupData = this.popups.get(popupId);
    if (!popupData) return;

    const popup = popupData.element;
    const container = document.querySelector('.container');
    const modeToggleBtn = popup.querySelector('.popup-mode-toggle-btn');

    if (mode === 'inset') {
      // Switch to inset mode
      // Close any other inset popup first
      if (this.insetPopup && this.insetPopup !== popupId) {
        this.setPopupMode(this.insetPopup, 'windowed');
      }

      popupData.mode = 'inset';
      this.insetPopup = popupId;

      popup.classList.add('inset-mode');
      popup.classList.remove('windowed-mode');
      container.classList.add('has-inset-popup');

      modeToggleBtn.dataset.mode = 'inset';
      modeToggleBtn.classList.add('active');

      // Move popup to inset container
      const insetContainer = this.getOrCreateInsetContainer();
      insetContainer.appendChild(popup);

    } else {
      // Switch to windowed mode
      popupData.mode = 'windowed';
      if (this.insetPopup === popupId) {
        this.insetPopup = null;
      }

      popup.classList.remove('inset-mode');
      popup.classList.add('windowed-mode');
      container.classList.remove('has-inset-popup');

      modeToggleBtn.dataset.mode = 'windowed';
      modeToggleBtn.classList.remove('active');

      // Moe popup back to body
      document.body.appendChild(popup);

      // Reposition to a reasonable location
      popup.style.left = '50%';
      popup.style.top = '50%';
      popup.style.transform = 'translate(-50%, -50%)';
    }
  }

  getOrCreateInsetContainer() {
    let insetContainer = document.querySelector('.popup-inset-container');
    if (!insetContainer) {
      insetContainer = document.createElement('div');
      insetContainer.className = 'popup-inset-container';
      const container = document.querySelector('.container');
      container.parentElement.insertBefore(insetContainer, container.nextSibling);
    }
    return insetContainer;
  }

  bringToFront(popupId) {
    const popupData = this.popups.get(popupId);
    if (!popupData) return;

    popupData.element.style.zIndex = this.zIndexCounter++;
  }

  closePopup(popupId) {
    const popupData = this.popups.get(popupId);
    if (!popupData) return;

    const popup = popupData.element;
    const container = document.querySelector('.container');

    // Clear any pending hide timeout
    if (popupData.hideTimeout) {
      clearTimeout(popupData.hideTimeout);
      popupData.hideTimeout = null;
    }

    // Clear ASCII animation interval if exists
    if (popup.dataset.asciiInterval) {
      clearInterval(parseInt(popup.dataset.asciiInterval));
    }

    // Clean up inset mode if active
    if (popupData.mode === 'inset') {
      container.classList.remove('has-inset-popup');
      this.insetPopup = null;
    }

    // Fade out and remove
    popup.classList.remove('visible');
    setTimeout(() => {
      popup.remove();
      this.popups.delete(popupId);
    }, 300);
  }

  closeAllPopups() {
    this.popups.forEach((popupData, popupId) => {
      this.closePopup(popupId);
    });
  }

  findPopupByContent(content) {
    for (const [id, data] of this.popups) {
      if (data.content === content) {
        return data;
      }
    }
    return null;
  }

  /**
   * Get the natural dimensions of the popup after CSS has sized it
   * This is ONLY used for positioning, not for sizing
   */
  getPopupDimensions(popup) {
    // Temporarily make popup visible but hidden to measure its natural size
    const wasVisible = popup.classList.contains('visible');
    const originalVisibility = popup.style.visibility;

    popup.style.visibility = 'hidden';
    popup.style.display = 'flex';
    if (!wasVisible) {
      popup.classList.add('visible');
    }

    // Force reflow and measure
    popup.offsetHeight;
    const rect = popup.getBoundingClientRect();

    // Restore original state
    if (!wasVisible) {
      popup.classList.remove('visible');
    }
    popup.style.visibility = originalVisibility;

    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  handleWindowResize() {
    // Recalculate popup positions on window resize
    this.popups.forEach((popupData, popupId) => {
      if (popupData.mode === 'windowed') {
        const popup = popupData.element;
        // Ensure popup stays within viewport
        const rect = popup.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
          popup.style.left = `${window.innerWidth - rect.width - 20}px`;
        }
        if (rect.bottom > window.innerHeight) {
          popup.style.top = `${window.innerHeight - rect.height - 20}px`;
        }
      }
    });
  }
}

// Initialize popup system when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.popupManager = new PopupManager();

  // Handle window resize
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (window.popupManager) {
        window.popupManager.handleWindowResize();
      }
    }, 250);
  });
});
