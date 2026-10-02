/* =============================================================
   TestEvo-Bench — leaderboard.js
   Loads data/leaderboard.json (per-task Lite results from the
   paper), renders one table per track tab, and recomputes the
   averages whenever the shared time-window slider changes.
============================================================= */

(function () {
  const DATA_LB = "data/leaderboard.json";
  const TRACK_SHORT = { update: "u", generation: "g", refinement: "r" };

  const METRIC_DEFS = [
    ["Success", "Share of tasks in which every target test meets its track criterion: update and generation tests must pass on the new revision and fail on the old one; refinement tests must pass and raise coverage."],
    ["CovOnPass", "Line coverage of the production methods that the developer's test executes, averaged over the targets of each solved task and then over the tasks the configuration solves."],
    ["MutOnPass", "Share of Universal Mutator mutants of the changed methods (up to ten per method) that the test kills, averaged like CovOnPass over the tasks the configuration solves."],
    ["Overall", "Per-task score: (1 + CovOnPass + MutOnPass) / 3 for a fully successful task, otherwise its graded progress (0 no compile, 1/3 compiles but fails, 2/3 passes but misses the criterion)."],
    ["Tasks", "Lite tasks in the selected window for this track. Each run is limited to 1 hour and US$3 per task; mini-SWE-agent runs also stop after 250 steps."],
    ["Developer tests", "The developer's own tests from the commit, scored the same way. They meet the track criterion on every Lite task, so their Success is 100%. Shown for reference and not ranked."],
  ];

  const state = { data: null, currentTrack: "all" };

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ------------------------------------------------------------------
     Each task in entry.tasks has:
       d – rev2 date "YYYY-MM-DD", t – track (u / g / r)
       s – binary success (0/1), c – CovOnPass, m – MutOnPass,
       o – Overall (c, m, o are null when undefined for the task;
       c and m are also null for tasks the configuration does not solve)
     Success averages over every task; the others over tasks that
     have a value, exactly as the paper's Table 3.
     An entry with reference: true (developer tests) is listed last,
     unranked and never bolded.
  ------------------------------------------------------------------ */

  function getWindow() {
    const ns = window.TestEvoBench;
    return ns && ns.getState ? ns.getState() : null; // null → whole range
  }

  function inWindow(day, win) {
    if (!win || !day) return true;
    return day >= win.minDay && day <= win.maxDay;
  }

  function computeMetrics(tasks, win, track) {
    const want = TRACK_SHORT[track];
    const acc = { s: [], c: [], m: [], o: [] };
    for (const t of tasks) {
      if (want && t.t !== want) continue;
      if (!inWindow(t.d, win)) continue;
      for (const k of Object.keys(acc)) if (t[k] != null) acc[k].push(t[k]);
    }
    const pct = (xs) => xs.length ? 100 * xs.reduce((a, b) => a + b, 0) / xs.length : null;
    return { n: acc.s.length, s: pct(acc.s), c: pct(acc.c), m: pct(acc.m), o: pct(acc.o) };
  }

  function fmtPct(v) {
    return v == null ? '<span class="metric-pending">—</span>' : v.toFixed(1) + "%";
  }

  function renderTable() {
    if (!state.data) return;
    const tbody = $("leaderboard-tbody");
    const track = state.currentTrack;
    const win = getWindow();

    const all = state.data.entries
      .filter(e => track === "all" ? e.tracks.length === 3 : e.tracks.includes(track))
      .map(e => ({ e, m: computeMetrics(e.tasks, win, track) }));
    const rows = all.filter(r => !r.e.reference);
    const refs = all.filter(r => r.e.reference);

    // Rank by Overall, then Success; empty rows last.
    const key = (r) => [r.m.o ?? -1, r.m.s ?? -1];
    rows.sort((a, b) => key(b)[0] - key(a)[0] || key(b)[1] - key(a)[1]);

    const round1 = (v) => v == null ? null : Math.round(v * 10) / 10;
    const best = {};
    for (const k of ["s", "c", "m", "o"]) {
      const vals = rows.map(r => round1(r.m[k])).filter(v => v != null);
      best[k] = vals.length ? Math.max(...vals) : null;
    }
    const cell = (m, k, ref) => {
      const html = fmtPct(m[k]);
      return !ref && round1(m[k]) != null && round1(m[k]) === best[k] ? `<strong>${html}</strong>` : html;
    };

    tbody.innerHTML = "";
    [...rows, ...refs].forEach(({ e, m }, i) => {
      const ref = !!e.reference;
      const tr = document.createElement("tr");
      if (ref) tr.className = "lb-reference";
      tr.innerHTML = `
        <td>${ref || !m.n ? "—" : i + 1}</td>
        <td>${escapeHtml(e.agent)}</td>
        <td>${escapeHtml(e.model)}</td>
        <td>${cell(m, "s", ref)}</td>
        <td>${cell(m, "c", ref)}</td>
        <td>${cell(m, "m", ref)}</td>
        <td>${cell(m, "o", ref)}</td>
        <td>${m.n}</td>`;
      tbody.appendChild(tr);
    });
    if (rows.length === 0 || rows.every(r => r.m.n === 0)) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty">No Lite tasks in the selected window.</td></tr>`;
    }

    const note = $("lb-window-note");
    if (note) {
      const n = Math.max(0, ...all.map(r => r.m.n));
      const scope = track === "all" ? "all three tracks" : `the ${track} track`;
      note.textContent = `${n.toLocaleString()} Lite tasks on ${scope} in the selected window. ` +
        (track === "update" ? "TestUpdater and ReAccept were run on the update track only." : "");
      note.style.display = "";
    }
  }

  function renderMetricDefs() {
    const dl = $("metric-defs-dl");
    if (!dl) return;
    dl.innerHTML = "";
    for (const [k, v] of METRIC_DEFS) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
  }

  function wireTabs() {
    const tabs = document.querySelectorAll(".lb-tab");
    tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        tabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        state.currentTrack = tab.dataset.track;
        renderTable();
      });
    });
  }

  // explorer.js calls this when the slider moves
  window.TestEvoBench = window.TestEvoBench || {};
  window.TestEvoBench.renderLeaderboard = renderTable;

  async function init() {
    renderMetricDefs();
    try {
      const res = await fetch(DATA_LB, { cache: "no-cache" });
      if (!res.ok) throw new Error(`Failed to load ${DATA_LB}: ${res.status}`);
      state.data = await res.json();
      wireTabs();
      renderTable();
    } catch (err) {
      console.error(err);
      $("leaderboard-tbody").innerHTML =
        `<tr><td colspan="8" class="empty">Failed to load leaderboard: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
