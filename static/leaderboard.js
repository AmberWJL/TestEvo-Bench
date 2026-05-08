/* =============================================================
   TestEvo-Bench — leaderboard.js
   Loads data/leaderboard.json (per-task rates embedded), renders
   two tab-switchable tables, and recomputes macro averages live
   whenever the shared time-window slider changes.
============================================================= */

(function () {
  const DATA_LB = "data/leaderboard.json";

  const state = {
    data: null,
    currentTrack: "test_update",
  };

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ------------------------------------------------------------------
     Metric computation: filter tasks by date window, recompute averages.

     Each task object (stored in entry.tasks) has:
       d    – "YYYY-MM-DD" rev2 date
       pass, exec, cmpl, hrns  – per-task funnel rates  [0, 1]
       cov  – per-task CovOnPass (null when no paired data)
       mut  – per-task MutOnPass (null when no paired data)
       disc – per-task Success rate (generation track only)

     Macro average: mean over all tasks in the window that have a value
     for that metric. Values already as 0-1 fractions; we display as %.
  ------------------------------------------------------------------ */

  function getWindow() {
    if (window.TestEvoBench && window.TestEvoBench.getState) {
      return window.TestEvoBench.getState(); // { minDay, maxDay }
    }
    return null; // explorer not loaded yet → show all
  }

  function inWindow(day, win) {
    if (!win || !day) return true; // no filter applied
    return day >= win.minDay && day <= win.maxDay;
  }

  function computeMetrics(tasks, win, hasDisc) {
    const pass = [], exec = [], cmpl = [], hrns = [], cov = [], mut = [], disc = [];
    let taskCount = 0;
    for (const t of tasks) {
      if (!inWindow(t.d, win)) continue;
      taskCount++;
      pass.push(t.pass);
      exec.push(t.exec);
      cmpl.push(t.cmpl);
      hrns.push(t.hrns);
      if (t.cov != null) cov.push(t.cov);
      if (t.mut != null) mut.push(t.mut);
      if (hasDisc && t.disc != null) disc.push(t.disc);
    }
    const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    const pct  = (xs) => { const v = mean(xs); return v == null ? null : Math.round(v * 10000) / 100; };
    return {
      taskCount,
      pass_pct:          pct(pass),
      exec_fail_pct:     pct(exec),
      cmpl_fail_pct:     pct(cmpl),
      hrns_fail_pct:     pct(hrns),
      coverage_on_pass:  pct(cov),
      mutation_on_pass:  pct(mut),
      discriminating_pct: hasDisc ? pct(disc) : null,
    };
  }

  /* ------------------------------------------------------------------
     Formatting helpers
  ------------------------------------------------------------------ */

  function fmtPct(v) {
    if (v == null) return '<span class="metric-pending">—</span>';
    return v.toFixed(1) + "%";
  }

  function bold(html, isBest) {
    return isBest ? `<strong>${html}</strong>` : html;
  }

  function maxVal(vals) {
    const v = vals.filter(x => x != null);
    return v.length ? Math.max(...v) : null;
  }
  function minVal(vals) {
    const v = vals.filter(x => x != null);
    return v.length ? Math.min(...v) : null;
  }

  /* ------------------------------------------------------------------
     Render table
  ------------------------------------------------------------------ */

  function renderTable() {
    if (!state.data) return;
    const tbody = $("leaderboard-tbody");
    const track = state.currentTrack;
    const entries = state.data.tracks[track] || [];
    const hasDisc = track === "test_generation";

    // Success% column only visible on test_generation.
    const successHeader = document.querySelector("th.success-col");
    if (successHeader) successHeader.style.display = hasDisc ? "" : "none";

    const win = getWindow();

    // Compute per-entry metrics for the current window.
    const computed = entries.map(e => ({
      entry: e,
      metrics: computeMetrics(e.tasks || [], win, hasDisc),
    }));

    // Sort: Pass% desc (nulls last), then model name.
    computed.sort((a, b) => {
      const ap = a.metrics.pass_pct, bp = b.metrics.pass_pct;
      if (ap != null && bp == null) return -1;
      if (bp != null && ap == null) return 1;
      if (ap != null && bp != null && ap !== bp) return bp - ap;
      return (a.entry.model || "").localeCompare(b.entry.model || "");
    });

    if (computed.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" class="empty">No submissions yet.</td></tr>`;
      return;
    }

    // Find best values for bolding.
    const allM = computed.map(c => c.metrics);
    const bestPass = maxVal(allM.map(m => m.pass_pct));
    const bestExec = minVal(allM.map(m => m.exec_fail_pct));
    const bestCmpl = minVal(allM.map(m => m.cmpl_fail_pct));
    const bestHrns = minVal(allM.map(m => m.hrns_fail_pct));
    const bestCov  = maxVal(allM.map(m => m.coverage_on_pass));
    const bestMut  = maxVal(allM.map(m => m.mutation_on_pass));
    const bestDisc = hasDisc ? maxVal(allM.map(m => m.discriminating_pct)) : null;

    tbody.innerHTML = "";
    let rank = 0;
    for (const { entry: e, metrics: m } of computed) {
      rank++;
      const hasAny = Object.values(m).some(v => typeof v === "number");
      const successCell = hasDisc
        ? `<td>${bold(fmtPct(m.discriminating_pct), m.discriminating_pct === bestDisc)}</td>`
        : `<td style="display:none"></td>`;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${hasAny ? rank : "—"}</td>
        <td>${escapeHtml(e.agent || "")}</td>
        <td>${escapeHtml(e.model || "")}</td>
        ${successCell}
        <td>${bold(fmtPct(m.pass_pct),      m.pass_pct      === bestPass)}</td>
        <td>${bold(fmtPct(m.exec_fail_pct), m.exec_fail_pct === bestExec)}</td>
        <td>${bold(fmtPct(m.cmpl_fail_pct), m.cmpl_fail_pct === bestCmpl)}</td>
        <td>${bold(fmtPct(m.hrns_fail_pct), m.hrns_fail_pct === bestHrns)}</td>
        <td>${bold(fmtPct(m.coverage_on_pass),  m.coverage_on_pass  === bestCov)}</td>
        <td>${bold(fmtPct(m.mutation_on_pass),  m.mutation_on_pass  === bestMut)}</td>
        <td>${e.submission_date
          ? escapeHtml(e.submission_date)
          : '<span class="metric-pending">pending</span>'}</td>
      `;
      tbody.appendChild(tr);
    }

    // Show task count in the window note if we have window info.
    const note = $("lb-window-note");
    if (note && win) {
      const taskCount = computed.reduce((s, c) => s + c.metrics.taskCount, 0) / computed.length;
      note.textContent = `Metrics computed over ${Math.round(taskCount)} tasks in the selected window.`;
      note.style.display = "";
    } else if (note) {
      note.style.display = "none";
    }
  }

  /* ------------------------------------------------------------------
     Metric definitions
  ------------------------------------------------------------------ */

  function renderMetricDefs() {
    const dl = $("metric-defs-dl");
    if (!dl || !state.data.metric_definitions) return;
    dl.innerHTML = "";
    for (const [k, v] of Object.entries(state.data.metric_definitions)) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
  }

  /* ------------------------------------------------------------------
     Tab wiring
  ------------------------------------------------------------------ */

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

  /* ------------------------------------------------------------------
     Public hook — explorer.js calls this when the slider moves
  ------------------------------------------------------------------ */

  window.TestEvoBench = window.TestEvoBench || {};
  window.TestEvoBench.renderLeaderboard = renderTable;

  /* ------------------------------------------------------------------
     Bootstrap
  ------------------------------------------------------------------ */

  async function init() {
    try {
      const res = await fetch(DATA_LB, { cache: "no-cache" });
      if (!res.ok) throw new Error(`Failed to load ${DATA_LB}: ${res.status}`);
      state.data = await res.json();
      wireTabs();
      renderMetricDefs();
      renderTable();
    } catch (err) {
      console.error(err);
      $("leaderboard-tbody").innerHTML =
        `<tr><td colspan="11" class="empty">Failed to load leaderboard: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
