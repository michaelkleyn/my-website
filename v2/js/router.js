/**
 * SPA Router with anime.js transitions
 * Handles navigation without full page reloads
 */

(function() {
  'use strict';

  const CONTENT_SELECTOR = '#content';
  const NAV_LINK_SELECTOR = 'nav a:not([href^="http"]):not([href^="#"]):not([data-no-router])';

  // Animation settings
  const TRANSITION_DURATION = 300;
  const TRANSITION_EASING = 'easeOutQuad';

  let isTransitioning = false;

  /**
   * Initialize the router
   */
  function init() {
    // Intercept nav link clicks
    document.addEventListener('click', handleLinkClick);

    // Handle browser back/forward
    window.addEventListener('popstate', handlePopState);

    // Mark initial state
    history.replaceState({ path: window.location.pathname }, '', window.location.pathname);

    console.log('[Router] Initialized');
  }

  /**
   * Handle link clicks
   */
  function handleLinkClick(e) {
    const link = e.target.closest('a');
    if (!link) return;

    // Check if this is a routable link
    const href = link.getAttribute('href');
    if (!href) return;
    if (href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) return;
    if (link.hasAttribute('data-no-router')) return;
    if (link.target === '_blank') return;

    // Check if it's a nav link or internal link we should handle
    if (!link.matches(NAV_LINK_SELECTOR) && !link.closest(CONTENT_SELECTOR)) return;

    e.preventDefault();

    if (isTransitioning) return;

    navigateTo(href);
  }

  /**
   * Handle browser back/forward
   */
  function handlePopState(e) {
    if (e.state && e.state.path) {
      navigateTo(e.state.path, false);
    }
  }

  /**
   * Navigate to a new page
   */
  async function navigateTo(path, pushState = true) {
    if (isTransitioning) return;
    isTransitioning = true;

    const content = document.querySelector(CONTENT_SELECTOR);
    if (!content) {
      console.error('[Router] Content container not found');
      isTransitioning = false;
      return;
    }

    try {
      // Animate out
      await animateOut(content);

      // Fetch new content
      const newContent = await fetchPageContent(path);

      // Swap content
      content.innerHTML = newContent.html;

      // Update page title
      if (newContent.title) {
        document.title = newContent.title;
      }

      // Update active nav state
      updateActiveNav(path);

      // Update history
      if (pushState) {
        history.pushState({ path }, '', path);
      }

      // Scroll to top
      window.scrollTo(0, 0);

      // Animate in
      await animateIn(content);

      // Re-run any content-specific scripts
      initContentScripts();

    } catch (error) {
      console.error('[Router] Navigation failed:', error);
      // Fallback to regular navigation
      window.location.href = path;
    } finally {
      isTransitioning = false;
    }
  }

  /**
   * Fetch page content and extract the main content area
   */
  async function fetchPageContent(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Extract content
    const contentEl = doc.querySelector(CONTENT_SELECTOR);
    if (!contentEl) {
      throw new Error('Content element not found in fetched page');
    }

    // Extract title
    const titleEl = doc.querySelector('title');
    const title = titleEl ? titleEl.textContent : null;

    return {
      html: contentEl.innerHTML,
      title
    };
  }

  /**
   * Animate content out
   */
  function animateOut(element) {
    return new Promise(resolve => {
      anime({
        targets: element,
        opacity: [1, 0],
        translateY: [0, -10],
        duration: TRANSITION_DURATION,
        easing: TRANSITION_EASING,
        complete: resolve
      });
    });
  }

  /**
   * Animate content in
   */
  function animateIn(element) {
    return new Promise(resolve => {
      // Reset position
      element.style.opacity = '0';
      element.style.transform = 'translateY(10px)';

      anime({
        targets: element,
        opacity: [0, 1],
        translateY: [10, 0],
        duration: TRANSITION_DURATION,
        easing: TRANSITION_EASING,
        complete: () => {
          // Clean up inline styles
          element.style.opacity = '';
          element.style.transform = '';
          resolve();
        }
      });
    });
  }

  /**
   * Update active state in navigation
   */
  function updateActiveNav(path) {
    // Remove existing active states
    document.querySelectorAll('nav a').forEach(link => {
      link.classList.remove('active');
    });

    // Find and mark current page
    const currentLink = document.querySelector(`nav a[href="${path}"]`);
    if (currentLink) {
      currentLink.classList.add('active');
    }
  }

  /**
   * Initialize scripts that need to run on new content
   */
  function initContentScripts() {
    // Re-initialize blog scroll-spy if on a blog page
    if (typeof initBlogScrollSpy === 'function') {
      initBlogScrollSpy();
    }

    // Re-initialize syntax highlighting if present
    if (typeof hljs !== 'undefined') {
      document.querySelectorAll('pre code').forEach(block => {
        hljs.highlightElement(block);
      });
    }

    // Dispatch custom event for other scripts to hook into
    document.dispatchEvent(new CustomEvent('routeChanged', {
      detail: { path: window.location.pathname }
    }));
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging
  window.SpaRouter = { navigateTo };

})();
