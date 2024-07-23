document.addEventListener("DOMContentLoaded", function () {
  const navLink = document.querySelector("nav a:first-of-type");
  const animatedText = document.querySelector('.animated-text');

  const updateLinkText = () => {
    if (window.innerWidth <= 576) {
      navLink.textContent = "mkleyn";
    } else {
      navLink.textContent = "mkleyn.com";
    }
  };

  window.addEventListener("resize", updateLinkText);
  updateLinkText();

  // Function to animate text deletion
  function deleteText() {
    let text = animatedText.textContent;
    let i = text.length;
    animatedText.textContent = text + '|'; // Add carat at the end
    const deleteInterval = setInterval(() => {
      if (i > 0) {
        animatedText.textContent = text.slice(0, --i) + '|';
      } else {
        clearInterval(deleteInterval);
        // Here you would navigate to the new page
      }
    }, 50);
  }

  // Call this function when you want to navigate away
  document.querySelectorAll('nav a').forEach(link => {
    link.addEventListener('click', (e) => {
      if (link.getAttribute('href').startsWith('http')) return; // Don't handle external links
      e.preventDefault();
      deleteText();
      setTimeout(() => {
        window.location = link.href;
      }, 500);
    });
  });

  // Function to animate text typing
  function typeText(text) {
    let i = 0;
    animatedText.textContent = '|';
    const typeInterval = setInterval(() => {
      if (i < text.length) {
        animatedText.textContent = text.slice(0, ++i) + '|';
      } else {
        clearInterval(typeInterval);
        animatedText.textContent = text; // Remove carat at the end
      }
    }, 50);
  }

  // Check if this is a page load or refresh
  if (performance.navigation.type === performance.navigation.TYPE_NAVIGATE) {
    // This is a new page load
    setTimeout(() => {
      typeText(animatedText.textContent);
    }, 200);
  }
});