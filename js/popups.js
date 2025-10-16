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
      let hoverTimeout;

      // Show popup on hover (with delay)
      link.addEventListener('mouseenter', (e) => {
        hoverTimeout = setTimeout(() => {
          this.showPopup(link, e);
        }, 300); // 300ms delay before showing
      });

      // Cancel hover if mouse leaves quickly
      link.addEventListener('mouseleave', () => {
        clearTimeout(hoverTimeout);
      });
    });
  }

  async showPopup(link, event) {
    const popupContent = link.dataset.popup;
    const popupType = link.dataset.popupType || 'html'; // html, image, text

    // Don't create duplicate popups for the same content
    const existingPopup = this.findPopupByContent(popupContent);
    if (existingPopup) {
      this.bringToFront(existingPopup.id);
      return;
    }

    // Create popup element
    const popupId = this.nextPopupId++;
    const popup = this.createPopupElement(popupId);

    // Load content
    await this.loadContent(popup, popupContent, popupType);

    // Position near the link (initial position)
    this.positionNearElement(popup, link);

    // Add to DOM and tracking
    document.body.appendChild(popup);
    this.popups.set(popupId, {
      id: popupId,
      element: popup,
      content: popupContent,
      mode: 'windowed', // windowed or inset
      isDragging: false
    });

    // Fade in
    requestAnimationFrame(() => {
      popup.classList.add('visible');
    });

    // Setup interactions
    this.setupPopupInteractions(popupId);
  }

  createPopupElement(popupId) {
    const popup = document.createElement('div');
    popup.className = 'popup-window';
    popup.dataset.popupId = popupId;
    popup.style.zIndex = this.zIndexCounter++;

    popup.innerHTML = `
      <div class="popup-header">
        <div class="popup-title">Loading...</div>
        <div class="popup-controls">
          <button class="popup-btn popup-inset-btn" title="Inset Mode" aria-label="Inset mode">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="12" height="12" stroke="currentColor" stroke-width="1.5"/>
              <line x1="10" y1="2" x2="10" y2="14" stroke="currentColor" stroke-width="1.5"/>
            </svg>
          </button>
          <button class="popup-btn popup-windowed-btn active" title="Windowed Mode" aria-label="Windowed mode">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="3" width="10" height="10" stroke="currentColor" stroke-width="1.5"/>
              <line x1="3" y1="6" x2="13" y2="6" stroke="currentColor" stroke-width="1.5"/>
            </svg>
          </button>
          <button class="popup-btn popup-close-btn" title="Close" aria-label="Close popup">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" stroke-width="1.5"/>
              <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" stroke-width="1.5"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="popup-body">
        <div class="popup-loading">Loading content...</div>
      </div>
    `;

    return popup;
  }

  async loadContent(popup, contentPath, contentType) {
    const body = popup.querySelector('.popup-body');
    const title = popup.querySelector('.popup-title');

    try {
      if (contentType === 'image') {
        // Load image
        const img = document.createElement('img');
        img.src = contentPath;
        img.alt = 'Popup content';
        img.onload = () => {
          body.innerHTML = '';
          body.appendChild(img);
          title.textContent = 'Image';
        };
        img.onerror = () => {
          body.innerHTML = '<p class="popup-error">Failed to load image</p>';
          title.textContent = 'Error';
        };
      } else if (contentType === 'html') {
        // Load HTML snippet
        const response = await fetch(contentPath);
        if (!response.ok) throw new Error('Failed to load content');

        const html = await response.text();
        body.innerHTML = html;

        // Try to extract title from first heading
        const heading = body.querySelector('h1, h2, h3, h4');
        if (heading) {
          title.textContent = heading.textContent;
        } else {
          title.textContent = 'Content';
        }
      } else if (contentType === 'text') {
        // Direct text content
        body.innerHTML = `<p>${contentPath}</p>`;
        title.textContent = 'Note';
      }
    } catch (error) {
      body.innerHTML = '<p class="popup-error">Failed to load content</p>';
      title.textContent = 'Error';
      console.error('Popup content load error:', error);
    }
  }

  positionNearElement(popup, element) {
    const rect = element.getBoundingClientRect();
    const popupWidth = 400; // Default width
    const popupHeight = 300; // Estimated height

    // Position to the right of the element if space, otherwise to the left
    let left = rect.right + 10;
    if (left + popupWidth > window.innerWidth) {
      left = rect.left - popupWidth - 10;
    }

    // Vertically center with the element
    let top = rect.top + (rect.height / 2) - (popupHeight / 2);

    // Keep within viewport
    top = Math.max(20, Math.min(top, window.innerHeight - popupHeight - 20));
    left = Math.max(20, Math.min(left, window.innerWidth - popupWidth - 20));

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  setupPopupInteractions(popupId) {
    const popupData = this.popups.get(popupId);
    if (!popupData) return;

    const popup = popupData.element;
    const header = popup.querySelector('.popup-header');
    const closeBtn = popup.querySelector('.popup-close-btn');
    const windowedBtn = popup.querySelector('.popup-windowed-btn');
    const insetBtn = popup.querySelector('.popup-inset-btn');

    // Close button
    closeBtn.addEventListener('click', () => {
      this.closePopup(popupId);
    });

    // Windowed mode button
    windowedBtn.addEventListener('click', () => {
      this.setPopupMode(popupId, 'windowed');
    });

    // Inset mode button
    insetBtn.addEventListener('click', () => {
      this.setPopupMode(popupId, 'inset');
    });

    // Bring to front on click
    popup.addEventListener('mousedown', () => {
      this.bringToFront(popupId);
    });

    // Dragging (will be implemented in next phase)
    this.setupDragging(popupId, header);
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
    const windowedBtn = popup.querySelector('.popup-windowed-btn');
    const insetBtn = popup.querySelector('.popup-inset-btn');

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

      windowedBtn.classList.remove('active');
      insetBtn.classList.add('active');

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

      windowedBtn.classList.add('active');
      insetBtn.classList.remove('active');

      // Move popup back to body
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
}

// Initialize popup system when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.popupManager = new PopupManager();
});
