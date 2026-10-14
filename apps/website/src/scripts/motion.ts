// Motion runtime: scroll reveals, scroll parallax, pointer tilt, card sheen.
// Inlined by the layout; zero dependencies, respects reduced motion.
//
// NOTE: returns ONLY raw JavaScript. The reveal CSS lives in global.css
// (bundled and painted before first render, so there is no flash), and the
// layout injects this string with <script is:inline set:html={...} />.
// Returning markup here previously nested <style>/<script> tags inside the
// layout's <script>, which the HTML parser swallowed and the runtime died
// silently — reveals never fired.
//
// Every effect below writes CSS custom properties or classes only. No effect
// adds, removes, or measures a layout box during a frame other than the batched
// read-then-write pass in the parallax loop, so scrolling stays on the
// compositor.

export function initMotion(): string {
  return `
(function () {
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── Scroll reveals ───────────────────────────────────────────────────────
  var revealEls = document.querySelectorAll(".reveal");
  if (reduced || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    revealEls.forEach(function (el) { io.observe(el); });
  }

  // ── Scroll parallax ──────────────────────────────────────────────────────
  // Elements opt in with data-parallax and an optional data-speed (default 1).
  // Progress is measured against the viewport centre, so an element starts
  // behind the plane and drifts forward as it travels up the screen.
  var parallaxEls = reduced ? [] : Array.prototype.slice.call(
    document.querySelectorAll("[data-parallax]")
  );
  if (parallaxEls.length) {
    var ticking = false;
    var apply = function () {
      ticking = false;
      var vh = window.innerHeight || 1;
      var centre = vh / 2;
      // Read every rect first, then write every style: no layout thrash.
      var plans = parallaxEls.map(function (el) {
        var r = el.getBoundingClientRect();
        var speed = parseFloat(el.getAttribute("data-speed") || "1");
        if (!isFinite(speed)) speed = 1;
        var p = (centre - (r.top + r.height / 2)) / vh;
        return { el: el, p: Math.max(-1.5, Math.min(1.5, p)), speed: speed };
      });
      plans.forEach(function (plan) {
        plan.el.style.setProperty("--py", (plan.p * plan.speed * -34).toFixed(2) + "px");
        plan.el.style.setProperty("--pz", (plan.p * plan.speed * 36).toFixed(2) + "px");
      });
    };
    var onScroll = function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(apply); }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    apply();
  }

  // ── Pointer tilt ─────────────────────────────────────────────────────────
  // Fine pointers only: on touch there is no hover to respond to, and tilting
  // on tap would fight the scroll gesture.
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (!reduced && fine) {
    document.querySelectorAll(".tilt").forEach(function (el) {
      var max = parseFloat(el.getAttribute("data-tilt") || "6");
      var write = function (rx, ry) {
        el.style.setProperty("--rx", rx.toFixed(2) + "deg");
        el.style.setProperty("--ry", ry.toFixed(2) + "deg");
      };
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect();
        var nx = (e.clientX - r.left) / r.width - 0.5;
        var ny = (e.clientY - r.top) / r.height - 0.5;
        el.classList.add("is-tracking");
        write(-ny * max * 2, nx * max * 2);
      });
      el.addEventListener("pointerleave", function () {
        el.classList.remove("is-tracking");
        write(0, 0);
      });
    });
  }

  // ── Pointer-tracked gradient sheen on cards ──────────────────────────────
  document.querySelectorAll(".card-sheen").forEach(function (card) {
    card.addEventListener("pointermove", function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty("--mx", (e.clientX - r.left) + "px");
      card.style.setProperty("--my", (e.clientY - r.top) + "px");
    });
  });
})();
`.trim();
}
