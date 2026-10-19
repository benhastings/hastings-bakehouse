// Load each photo window's image shortly before it scrolls into view.
(function () {
  var windows = document.querySelectorAll('[data-lazy]');
  if (!('IntersectionObserver' in window)) {
    windows.forEach(function (w) { w.classList.add('is-near'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('is-near'); io.unobserve(e.target); }
    });
  }, { rootMargin: '50% 0px' });
  windows.forEach(function (w) { io.observe(w); });
})();

// Previous/next buttons for the featured-post row. Without the script the row still scrolls by swipe or trackpad.
(function () {
  document.querySelectorAll('.reel').forEach(function (reel) {
    var track = reel.querySelector('.reel__track');
    var prev = reel.querySelector('[data-dir="-1"]');
    var next = reel.querySelector('[data-dir="1"]');
    if (!track || !prev || !next) return;
    reel.querySelector('.reel__nav').hidden = false;
    function update() {
      prev.disabled = track.scrollLeft <= 4;
      next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    }
    [prev, next].forEach(function (b) {
      b.addEventListener('click', function () {
        var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        track.scrollBy({ left: Number(b.dataset.dir) * track.clientWidth * 0.9, behavior: reduce ? 'auto' : 'smooth' });
      });
    });
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  });
})();
