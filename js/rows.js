// Row lists show five rows. A longer list scrolls, with a thin bar of a scrollbar in the left gutter (css: .rows.scroll).
// The cap is measured, not guessed: rows wrap on narrow screens.
(function () {
  var lists = document.querySelectorAll('.rows');
  function fit() {
    lists.forEach(function (ul) {
      if (!ul.offsetParent) return;   // in a hidden section: measured when it shows (hashchange)
      var five = ul.children[4], more = ul.children.length > 5;
      ul.classList.toggle('scroll', more);
      ul.style.maxHeight = more ? five.offsetTop + five.offsetHeight + 'px' : '';
    });
  }
  fit(); addEventListener('hashchange', fit); addEventListener('resize', fit);
})();
