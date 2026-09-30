// Motion runtime: scroll reveals + pointer-tracked card sheen.
// Inlined by the layout; zero dependencies, respects reduced motion.
//
// NOTE: returns ONLY raw JavaScript. The reveal CSS lives in global.css
// (bundled and painted before first render, so there is no flash), and the
// layout injects this string with <script is:inline set:html={...} />.
// Returning markup here previously nested <style>/<script> tags inside the
// layout's <script>, which the HTML parser swallowed and the runtime died
// silently — reveals never fired.

export function initMotion(): string {
  return `
(function () {
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  // Pointer-tracked gradient sheen on cards
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
