/* =============================================================
   TestEvo-Bench — explorer.js
   Loads data/index.json, populates the stat grid + repo table,
   wires the dual time-range slider + track chips + search box.
   Clicking a row lazy-loads data/repos/<name>.json and expands.
============================================================= */

(function () {
  const DATA_INDEX = "data/index.json";
  const REPO_DIR = "data/repos";
  const TRACKS = ["test_update", "test_generation"];
  const TRACK_SHORT = { test_update: "u", test_generation: "g" };
  const SHORT_TRACK = { u: "test_update", g: "test_generation" };

  // Default start date for the left slider thumb
  const DEFAULT_MIN_DATE = "2020-03-01";

  // --- state ---
  const state = {
    index: null,
    days: [],            // sorted unique days across all rev pairs (YYYY-MM-DD)
    minIdx: 0,
    maxIdx: 0,
    tracks: new Set(TRACKS),
    search: "",
    repoDetailCache: {}, // project_name -> detail
  };

  /* ---------- utilities ---------- */

  function $(id) { return document.getElementById(id); }

  function inWindow(day) {
    if (!day) return false;
    const lo = state.days[state.minIdx];
    const hi = state.days[state.maxIdx];
    return day >= lo && day <= hi;
  }

  function fmtNum(n) {
    if (n == null) return "—";
    return n.toLocaleString();
  }

  function fmtDateRange(pair) {
    if (!pair || !pair[0]) return "—";
    if (pair[0] === pair[1]) return pair[0];
    return `${pair[0]} → ${pair[1]}`;
  }

  function fmtDuration(startStr, endStr) {
    if (!startStr || !endStr) return "";
    const s = new Date(startStr);
    const e = new Date(endStr);
    if (isNaN(s) || isNaN(e) || e < s) return "";
    let years  = e.getFullYear() - s.getFullYear();
    let months = e.getMonth()    - s.getMonth();
    let days   = e.getDate()     - s.getDate();
    if (days < 0) {
      months -= 1;
      const prev = new Date(e.getFullYear(), e.getMonth(), 0);
      days += prev.getDate();
    }
    if (months < 0) { years -= 1; months += 12; }
    const parts = [];
    if (years)  parts.push(`${years} year${years  === 1 ? "" : "s"}`);
    if (months) parts.push(`${months} month${months === 1 ? "" : "s"}`);
    if (days)   parts.push(`${days} day${days   === 1 ? "" : "s"}`);
    return parts.join(", ") || "0 days";
  }

  /* ---------- data load ---------- */

  async function loadIndex() {
    const res = await fetch(DATA_INDEX, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to load ${DATA_INDEX}: ${res.status}`);
    return res.json();
  }

  async function loadRepoDetail(projectName) {
    if (state.repoDetailCache[projectName]) {
      return state.repoDetailCache[projectName];
    }
    const url = `${REPO_DIR}/${encodeURIComponent(projectName)}.json`;
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
    const detail = await res.json();
    state.repoDetailCache[projectName] = detail;
    return detail;
  }

  /* ---------- stat grid ---------- */

  function renderStats(idx) {
    const grid = $("stat-grid");
    grid.innerHTML = "";

    const tu = idx.stats.test_update;
    const tg = idx.stats.test_generation;
    const totalTasks = tu.tasks + tg.tasks;
    const totalChanges = tu.changes + tg.changes;

    const minDate = [tu.date_range[0], tg.date_range[0]].filter(Boolean).sort()[0];
    const maxDate = [tu.date_range[1], tg.date_range[1]].filter(Boolean).sort().slice(-1)[0];

    const tiles = [
      { label: "Repositories", value: fmtNum(idx.repos.length), sub: `${tu.repos} in test update · ${tg.repos} in test generation` },
      { label: "Tasks (rev pairs)", value: fmtNum(totalTasks), sub: `${fmtNum(tu.tasks)} update · ${fmtNum(tg.tasks)} gen` },
      { label: "Test changes", value: fmtNum(totalChanges), sub: `${fmtNum(tu.changes)} update · ${fmtNum(tg.changes)} gen` },
      { label: "Date range", value: `${minDate} → ${maxDate}`, sub: fmtDuration(minDate, maxDate) },
    ];
    for (const t of tiles) {
      const d = document.createElement("div");
      d.className = "stat";
      d.innerHTML = `<div class="label">${t.label}</div><div class="value">${t.value}</div><div class="sub">${t.sub}</div>`;
      grid.appendChild(d);
    }
  }

  /* ---------- time slider ---------- */

  function computeDayAxis(idx) {
    const s = new Set();
    for (const r of idx.repos) {
      for (const rp of r.rev_pairs) {
        if (rp.d) s.add(rp.d);
      }
    }
    return Array.from(s).sort();
  }

  /** Find the index in state.days that is >= the given date string */
  function findDayIndex(dateStr) {
    // Binary search for the first day >= dateStr
    let lo = 0, hi = state.days.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (state.days[mid] < dateStr) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function renderYearTicks() {
    const container = $("timeline-ticks");
    if (!container || state.days.length === 0) return;
    container.innerHTML = "";

    const firstDate = new Date(state.days[0]);
    const lastDate = new Date(state.days[state.days.length - 1]);
    const firstYear = firstDate.getFullYear();
    const lastYear = lastDate.getFullYear();

    // Total time span in ms
    const totalSpan = lastDate.getTime() - firstDate.getTime();
    if (totalSpan <= 0) return;

    for (let year = firstYear; year <= lastYear + 1; year++) {
      const yearDate = new Date(year, 0, 1);
      const offset = yearDate.getTime() - firstDate.getTime();
      const pct = Math.max(0, Math.min(100, (offset / totalSpan) * 100));

      // Only show if within range
      if (pct < 0 || pct > 100) continue;

      const tick = document.createElement("div");
      tick.className = "timeline-tick";
      tick.style.left = pct + "%";
      tick.innerHTML = `<div class="timeline-tick-mark"></div><div class="timeline-tick-label">${year}</div>`;
      container.appendChild(tick);
    }
  }

  function updateActiveRange() {
    const active = $("timeline-active");
    if (!active || state.days.length === 0) return;

    const total = state.days.length - 1;
    if (total <= 0) {
      active.style.left = "0%";
      active.style.width = "100%";
      return;
    }

    const leftPct = (state.minIdx / total) * 100;
    const rightPct = (state.maxIdx / total) * 100;
    active.style.left = leftPct + "%";
    active.style.width = (rightPct - leftPct) + "%";
  }

  function wireTimeSlider() {
    const mn = $("time-slider-min");
    const mx = $("time-slider-max");
    const lblMn = $("time-label-min");
    const lblMx = $("time-label-max");

    const maxVal = state.days.length - 1;
    mn.min = 0;
    mx.min = 0;
    mn.max = maxVal;
    mx.max = maxVal;

    // Default: left thumb at 2020-03, right thumb at rightmost
    const defaultMinIdx = findDayIndex(DEFAULT_MIN_DATE);
    mn.value = defaultMinIdx;
    mx.value = maxVal;
    state.minIdx = defaultMinIdx;
    state.maxIdx = maxVal;

    const update = () => {
      let lo = parseInt(mn.value, 10);
      let hi = parseInt(mx.value, 10);
      if (lo > hi) [lo, hi] = [hi, lo];
      state.minIdx = lo;
      state.maxIdx = hi;
      lblMn.textContent = state.days[lo] || "—";
      lblMx.textContent = state.days[hi] || "—";
      updateActiveRange();
      renderTable();
      if (window.TestEvoBench && window.TestEvoBench.renderLeaderboard) {
        window.TestEvoBench.renderLeaderboard();
      }
    };

    mn.addEventListener("input", update);
    mx.addEventListener("input", update);

    renderYearTicks();
    update();
  }

  /* ---------- repo filtering ---------- */

  function filterRepoRow(row) {
    if (state.search) {
      const q = state.search.toLowerCase();
      if (!row.project_name.toLowerCase().includes(q) &&
          !(row.display_name || "").toLowerCase().includes(q)) {
        return null;
      }
    }
    let tuTasks = 0, tuChanges = 0, tgTasks = 0, tgChanges = 0;
    let minD = null, maxD = null;
    for (const rp of row.rev_pairs) {
      if (!inWindow(rp.d)) continue;
      const track = SHORT_TRACK[rp.t];
      if (!state.tracks.has(track)) continue;
      if (track === "test_update")     { tuTasks++; tuChanges += rp.n; }
      if (track === "test_generation") { tgTasks++; tgChanges += rp.n; }
      if (!minD || rp.d < minD) minD = rp.d;
      if (!maxD || rp.d > maxD) maxD = rp.d;
    }
    if (tuTasks + tgTasks === 0) return null;
    return { row, tuTasks, tuChanges, tgTasks, tgChanges, dateRange: [minD, maxD] };
  }

  function renderTable() {
    const tbody = $("explorer-tbody");
    tbody.innerHTML = "";
    if (!state.index) return;

    const rows = [];
    for (const r of state.index.repos) {
      const f = filterRepoRow(r);
      if (f) rows.push(f);
    }
    rows.sort((a, b) => (b.tuTasks + b.tgTasks) - (a.tuTasks + a.tgTasks));

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">No repositories match the current filters.</td></tr>`;
      return;
    }

    for (const f of rows) {
      const r = f.row;
      const tr = document.createElement("tr");
      tr.className = "repo-row";
      tr.dataset.project = r.project_name;
      tr.innerHTML = `
        <td class="col-expand"><span class="caret"></span></td>
        <td class="col-repo">
          <div class="repo-name">${escapeHtml(r.display_name || r.project_name)}</div>
          <div class="repo-sub">${escapeHtml(r.project_name)}</div>
        </td>
        <td class="col-num">${f.tuTasks ? fmtNum(f.tuTasks) : '<span class="metric-pending">—</span>'}</td>
        <td class="col-num">${f.tgTasks ? fmtNum(f.tgTasks) : '<span class="metric-pending">—</span>'}</td>
        <td class="col-dates">${fmtDateRange(f.dateRange)}</td>
      `;
      tr.addEventListener("click", () => toggleRepoRow(tr, r));
      tbody.appendChild(tr);
    }
  }

  async function toggleRepoRow(tr, repo) {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains("rev-pair-row") && next.dataset.for === repo.project_name) {
      next.remove();
      tr.classList.remove("open");
      return;
    }
    tr.classList.add("open");
    const expanded = document.createElement("tr");
    expanded.className = "rev-pair-row";
    expanded.dataset.for = repo.project_name;
    const td = document.createElement("td");
    td.colSpan = 5;
    td.innerHTML = `<div class="loading">Loading rev pairs…</div>`;
    expanded.appendChild(td);
    tr.parentNode.insertBefore(expanded, tr.nextSibling);

    try {
      const detail = await loadRepoDetail(repo.project_name);
      td.innerHTML = renderRevPairs(detail);
    } catch (err) {
      td.innerHTML = `<div class="empty">Failed to load rev pairs: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderRevPairs(detail) {
    const rows = [];
    for (const track of TRACKS) {
      if (!state.tracks.has(track)) continue;
      for (const rp of detail.tracks[track] || []) {
        if (!inWindow(rp.rev2_date)) continue;
        rows.push({ track, rp });
      }
    }
    if (rows.length === 0) {
      return `<div class="empty">No rev pairs in the current time window.</div>`;
    }
    rows.sort((a, b) => (a.rp.rev2_date || "").localeCompare(b.rp.rev2_date || ""));

    let html = `
      <table class="rev-table">
        <thead>
          <tr>
            <th class="rev-col-track">Track</th>
            <th class="rev-col-date">rev2 date</th>
            <th class="rev-col-file">Test file</th>
            <th class="rev-col-methods">Test method(s)</th>
            <th class="rev-col-diff">Diff</th>
          </tr>
        </thead>
        <tbody>
    `;
    for (const { track, rp } of rows) {
      const tagCls = track === "test_update" ? "tu" : "tg";
      const testFile = rp.test_file || "—";
      const methodsHtml = (rp.test_methods || []).map(m =>
        `<div class="m">${escapeHtml(m)}</div>`
      ).join("") || '<div class="m metric-pending">—</div>';
      html += `
        <tr>
          <td><span class="track-tag ${tagCls}">${track.replace("_", " ")}</span></td>
          <td>${escapeHtml(rp.rev2_date || "—")}</td>
          <td class="test-file-cell" title="${escapeAttr(testFile)}">${escapeHtml(testFile)}</td>
          <td class="test-methods-cell"><div class="test-methods">${methodsHtml}</div></td>
          <td><a class="diff-link" href="${escapeAttr(rp.git_diff_url)}" target="_blank" rel="noopener">view ↗</a></td>
        </tr>
      `;
    }
    html += `</tbody></table>`;
    return html;
  }

  /* ---------- track chips + search ---------- */

  function wireChipsAndSearch() {
    for (const track of TRACKS) {
      const cb = $(`toggle-${track}`);
      cb.addEventListener("change", () => {
        if (cb.checked) state.tracks.add(track);
        else state.tracks.delete(track);
        renderTable();
        document.querySelectorAll("tr.rev-pair-row").forEach(r => r.remove());
        document.querySelectorAll("tr.repo-row.open").forEach(r => r.classList.remove("open"));
      });
    }
    const search = $("repo-search");
    search.addEventListener("input", () => {
      state.search = search.value.trim();
      renderTable();
    });
  }

  /* ---------- html escaping ---------- */

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* ---------- public state for leaderboard.js to read ---------- */

  window.TestEvoBench = window.TestEvoBench || {};
  window.TestEvoBench.getState = () => ({
    minDay: state.days[state.minIdx],
    maxDay: state.days[state.maxIdx],
    days: state.days,
    tracks: new Set(state.tracks),
  });

  /* ---------- bootstrap ---------- */

  async function init() {
    try {
      const idx = await loadIndex();
      state.index = idx;
      state.days = computeDayAxis(idx);
      if (state.days.length === 0) {
        state.days = ["2000-01-01"];
      }
      renderStats(idx);
      wireChipsAndSearch();
      wireTimeSlider();
      // renderTable() is triggered by wireTimeSlider -> update()
    } catch (err) {
      console.error(err);
      $("explorer-tbody").innerHTML =
        `<tr><td colspan="5" class="empty">Failed to load dataset: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
