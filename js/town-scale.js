// The town board's scale (city/index.html), the Field Console's own (K74,
// dev/field-console.html): a large screen at 1x zooms the whole board, in
// steps of 0.05, so it lays out like a desk of at least 1500 x 880 and every
// breakpoint answers as it does there (owner, 2026-11-01: "super zoom… so it
// scales to much larger displays while keeping the proportions"). 2560 x 1440
// is x1.6, 4K x2.45; a MacBook and every touch screen stay at 1x. A classic
// script in <head>, so the first frame is already at its size.
//
// --ui-zoom carries the zoom for anything that measures the screen: a rect
// comes back zoomed and a style is written in the page's own px
// (js/page-city.js divides by it). The board writes no viewport or container
// units, so nothing else counts it twice.
(function () {
  var de = document.documentElement;
  function scale() {
    var z = 1;
    try {
      if (matchMedia('(pointer: fine)').matches) {
        z = Math.floor(Math.min(innerWidth / 1500, innerHeight / 880, 2.5) * 20) / 20;
        if (z < 1.1) z = 1;
      }
    } catch (e) {}
    if (z === (parseFloat(de.style.zoom) || 1)) return;
    de.style.zoom = z === 1 ? '' : String(z);
    de.style.setProperty('--ui-zoom', String(z));
  }
  scale();
  addEventListener('resize', scale);
})();
