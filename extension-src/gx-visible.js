// Out of sight, still working (extension 0.20.0).
//
// The extension collects and publishes in its own MINIMIZED window, so it never
// covers what you are doing. Chrome treats a minimized (or covered) window as
// hidden, and LinkedIn does not draw a hidden page: tested in a real Chrome on
// 2026-10-13, Cytel's posts page in a hidden tab rendered 0 posts; the same page
// with this file in place rendered all 12.
//
// It runs in the page's own world before any of the page's scripts and tells
// the page three things Chrome stops providing in a hidden window:
//   - the page is visible (document.visibilityState / hidden / hasFocus)
//   - animation frames keep coming (requestAnimationFrame)
//   - watched elements are on screen (IntersectionObserver), which is what
//     loads the next posts as the scraper scrolls
//
// ONLY in the extension's own tabs. They are opened with "#gx-bg" at the end
// of the address (gx-collect.js, gx-publish.js); this file removes the marker
// at once and remembers it for that tab (sessionStorage), so later pages in the
// same tab keep working. Your own LinkedIn and X tabs never carry the marker
// and are left exactly as they are.
(function () {
  try {
    var KEY = "gx-bg";
    var on = false;
    if (location.hash.indexOf(KEY) !== -1) {
      on = true;
      try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
      try {
        var clean = location.href.replace(/#gx-bg$/, "").replace(/([#&])gx-bg(&|$)/, "$1").replace(/[#&]$/, "");
        history.replaceState(history.state, "", clean);
      } catch (e) {}
    } else {
      try { on = sessionStorage.getItem(KEY) === "1"; } catch (e) {}
    }
    if (!on) return;

    var D = Document.prototype;
    Object.defineProperty(D, "visibilityState", { configurable: true, get: function () { return "visible"; } });
    Object.defineProperty(D, "hidden", { configurable: true, get: function () { return false; } });
    D.hasFocus = function () { return true; };

    window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
    window.cancelAnimationFrame = function (id) { clearTimeout(id); };

    window.IntersectionObserver = function (cb) {
      var els = new Set();
      var self = this;
      this.root = null;
      this.rootMargin = "0px";
      this.thresholds = [0];
      this.observe = function (el) {
        els.add(el);
        setTimeout(function () {
          if (!els.has(el)) return;
          var r = el.getBoundingClientRect();
          try {
            cb([{ target: el, isIntersecting: true, intersectionRatio: 1, boundingClientRect: r, intersectionRect: r, rootBounds: null, time: performance.now() }], self);
          } catch (e) {}
        }, 50);
      };
      this.unobserve = function (el) { els.delete(el); };
      this.disconnect = function () { els.clear(); };
      this.takeRecords = function () { return []; };
    };

    window.__gxBackground = true;
  } catch (e) {}
})();
