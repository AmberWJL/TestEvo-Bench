/* =============================================================
   TestEvo-Bench — tracks.js
   Overview "Three tracks": the track cards are tabs; the selected
   card shows its example below. Showing a hidden pane restarts its
   CSS animation. Until the visitor picks a track, the tabs advance
   after each 15 s animation loop (not with reduced motion, not while
   the pointer is over the cards or the example).
============================================================= */

(function () {
  const tabs = Array.from(document.querySelectorAll(".track-tab"));
  if (!tabs.length) return;
  const panes = Array.from(document.querySelectorAll(".track-pane"));
  const LOOP_MS = 15000; // length of the example animation (style.css)
  let picked = false;
  let hovering = false;

  function show(key, focus) {
    tabs.forEach(t => {
      const on = t.dataset.key === key;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    panes.forEach(p => {
      const on = p.dataset.key === key;
      p.classList.toggle("active", on);
      p.hidden = !on;
    });
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => { picked = true; show(tab.dataset.key); });
    tab.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      let j = null;
      if (step) j = (i + step + tabs.length) % tabs.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = tabs.length - 1;
      if (j == null) return;
      e.preventDefault();
      picked = true;
      show(tabs[j].dataset.key, true);
    });
  });

  for (const el of document.querySelectorAll(".track-tabs, .track-panes")) {
    el.addEventListener("mouseenter", () => { hovering = true; });
    el.addEventListener("mouseleave", () => { hovering = false; });
  }

  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setInterval(() => {
      if (picked || hovering || document.hidden) return;
      const i = tabs.findIndex(t => t.classList.contains("active"));
      show(tabs[(i + 1) % tabs.length].dataset.key);
    }, LOOP_MS);
  }
})();
