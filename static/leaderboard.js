/* =============================================================
   TestEvo-Bench — leaderboard.js
   Loads data/leaderboard.json, renders two tab-switchable tables
   (test_update / test_generation), and re-renders whenever the
   explorer's time slider changes.
============================================================= */

(function () {
  const DATA_LB = "data/leaderboard.json";
  const METRIC_COLUMNS = [
    { key: "cpr",            label: "CPR",        tracks: ["test_update", "test_generation"] },
    { key: "tpr",            label: "TPR",        tracks: ["test_update", "test_generation"] },
    { key: "coverage_delta", label: "Cov Δ",      tracks: ["test_update"] },
    { key: "line_coverage",  label: "Line Cov",   tracks: ["test_update", "test_generation"] },
    { key: "mutation_score", label: "Mut Score",  tracks: ["test_update", "test_generation"] },
    { key: "test_smell",     label: "Test Smell", tracks: ["test_update", "test_generation"] },
  ];

  const state = {
    data: null,
    currentTrack: "test_update",
  };

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtMetric(v) {
    if (v == null) return '<span class="metric-pending">—</span>';
    if (typeof v === "number") {
      // Coverage/pass rates likely 0..1; render as percentage.
      if (v >= 0 && v <= 1) return (v * 100).toFixed(1) + "%";
      return v.toFixed(2);
    }
    return escapeHtml(v);
  }

  async function loadLeaderboard() {
    const res = await fetch(DATA_LB, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to load ${DATA_LB}: ${res.status}`);
    return res.json();
  }

  function renderTable() {
    if (!state.data) return;
    const tbody = $("leaderboard-tbody");
    const track = state.currentTrack;
    const entries = state.data.tracks[track] || [];

    // Show or hide the Coverage Delta column header based on track.
    const covDeltaHeader = document.querySelector("th.cov-delta-col");
    if (covDeltaHeader) {
      covDeltaHeader.style.display = track === "test_update" ? "" : "none";
    }

    // Sort: TPR desc (nulls last), then CPR desc (nulls last), then model name.
    const sorted = entries.slice().sort((a, b) => {
      const at = a.metrics.tpr, bt = b.metrics.tpr;
      if (at != null && bt == null) return -1;
      if (bt != null && at == null) return 1;
      if (at != null && bt != null && at !== bt) return bt - at;
      const ac = a.metrics.cpr, bc = b.metrics.cpr;
      if (ac != null && bc == null) return -1;
      if (bc != null && ac == null) return 1;
      if (ac != null && bc != null && ac !== bc) return bc - ac;
      return (a.model || "").localeCompare(b.model || "");
    });

    if (sorted.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty">No submissions yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";
    let rank = 0;
    for (const e of sorted) {
      rank++;
      const tr = document.createElement("tr");
      const hasAny = Object.values(e.metrics || {}).some(v => v != null);
      const rankCell = hasAny ? rank : "—";
      const covDeltaCell = track === "test_update"
        ? `<td>${fmtMetric(e.metrics.coverage_delta)}</td>`
        : `<td style="display:none"></td>`;
      const submissionCell = e.submission_date
        ? escapeHtml(e.submission_date)
        : '<span class="metric-pending">pending</span>';

      tr.innerHTML = `
        <td>${rankCell}</td>
        <td>
          <div class="model-name">${escapeHtml(e.model)}</div>
          <div class="org">${escapeHtml(e.organization || "")}</div>
        </td>
        <td>${fmtMetric(e.metrics.cpr)}</td>
        <td>${fmtMetric(e.metrics.tpr)}</td>
        ${covDeltaCell}
        <td>${fmtMetric(e.metrics.line_coverage)}</td>
        <td>${fmtMetric(e.metrics.mutation_score)}</td>
        <td>${fmtMetric(e.metrics.test_smell)}</td>
        <td>${submissionCell}</td>
      `;
      tbody.appendChild(tr);
    }
  }

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

  /* Exposed so explorer.js can trigger a re-render when the time slider
     changes. The current seeded rows don't actually depend on the time
     window (their metrics are all null), but once real submissions with
     per-task results land, this hook is where we'll recompute them. */
  window.TestEvoBench = window.TestEvoBench || {};
  window.TestEvoBench.renderLeaderboard = renderTable;

  async function init() {
    try {
      state.data = await loadLeaderboard();
      wireTabs();
      renderMetricDefs();
      renderTable();
    } catch (err) {
      console.error(err);
      $("leaderboard-tbody").innerHTML =
        `<tr><td colspan="9" class="empty">Failed to load leaderboard: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
