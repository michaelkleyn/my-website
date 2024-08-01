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

  // Simplified navigation handling
  document.querySelectorAll('nav a').forEach(link => {
    link.addEventListener('click', (e) => {
      if (link.getAttribute('href').startsWith('http')) return; // Don't handle external links
      e.preventDefault();
      window.location = link.href;
    });
  });
});