/**
 * Blog JavaScript - Scroll-spy for right navigation
 */

(function() {
  'use strict';

  // Get all section headings and nav links
  const headings = document.querySelectorAll('.blog-content h2, .blog-content h3');
  const navLinks = document.querySelectorAll('.right-nav a');

  if (headings.length === 0 || navLinks.length === 0) return;

  // Build a map of heading IDs to nav links
  const linkMap = new Map();
  navLinks.forEach(link => {
    const id = link.getAttribute('href').slice(1); // Remove #
    linkMap.set(id, link);
  });

  // Scroll spy using Intersection Observer
  const observerOptions = {
    root: null, // viewport
    rootMargin: '-20% 0px -70% 0px', // Trigger when heading is in top 30% of viewport
    threshold: 0
  };

  let currentActive = null;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute('id');
        const link = linkMap.get(id);

        if (link && link !== currentActive) {
          // Remove active from previous
          if (currentActive) {
            currentActive.classList.remove('active');
          }
          // Add active to current
          link.classList.add('active');
          currentActive = link;
        }
      }
    });
  }, observerOptions);

  // Observe all headings
  headings.forEach(heading => {
    if (heading.id) {
      observer.observe(heading);
    }
  });

  // Smooth scroll for nav links
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const id = link.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Update URL hash without jumping
        history.pushState(null, null, `#${id}`);
      }
    });
  });

  // Set initial active based on scroll position
  function setInitialActive() {
    const scrollPos = window.scrollY + window.innerHeight * 0.25;

    let activeHeading = null;
    headings.forEach(heading => {
      if (heading.offsetTop <= scrollPos) {
        activeHeading = heading;
      }
    });

    if (activeHeading && activeHeading.id) {
      const link = linkMap.get(activeHeading.id);
      if (link) {
        link.classList.add('active');
        currentActive = link;
      }
    }
  }

  // Run on load
  setInitialActive();
})();
