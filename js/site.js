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

// Gallery: show the first twelve with a button for the rest, and open any photo in a full-screen viewer.
// Without the script every photo shows and each link opens the large image.
(function () {
  document.querySelectorAll('[data-gallery]').forEach(function (list) {
    var section = list.closest('section');
    var more = section.querySelector('[data-more]');
    if (more && list.querySelector('.is-extra')) {
      list.classList.add('is-collapsed');
      more.hidden = false;
      more.addEventListener('click', function () {
        list.classList.remove('is-collapsed');
        more.hidden = true;
        var first = list.querySelector('.is-extra a');
        if (first) first.focus();
      });
    }

    var box = document.querySelector('.lightbox');
    if (!box || typeof box.showModal !== 'function') return;
    var img = box.querySelector('img');
    var cap = box.querySelector('figcaption');
    var links = Array.prototype.slice.call(list.querySelectorAll('.shot'));
    var at = 0;

    function show(i) {
      at = (i + links.length) % links.length;
      var link = links[at];
      img.src = link.getAttribute('href').replace(/\.jpg$/, '.webp');
      img.alt = link.querySelector('img').alt;
      cap.textContent = link.closest('figure').querySelector('figcaption').textContent;
      // Fetch the neighbours so stepping through feels instant.
      [at + 1, at - 1].forEach(function (n) {
        var l = links[(n + links.length) % links.length];
        new Image().src = l.getAttribute('href').replace(/\.jpg$/, '.webp');
      });
    }
    links.forEach(function (link, i) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        show(i);
        box.showModal();
      });
    });
    box.querySelector('.lightbox__prev').addEventListener('click', function () { show(at - 1); });
    box.querySelector('.lightbox__next').addEventListener('click', function () { show(at + 1); });
    box.querySelector('.lightbox__close').addEventListener('click', function () { box.close(); });
    box.addEventListener('click', function (e) { if (e.target === box || e.target.tagName === 'FIGURE') box.close(); });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') show(at - 1);
      if (e.key === 'ArrowRight') show(at + 1);
    });
    var x0 = null;
    box.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) show(dx < 0 ? at + 1 : at - 1);
      x0 = null;
    });
  });
})();
