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
});
