/* =============================================================
   TestEvo-Bench — explorer.js
   Loads data/index.json, populates the stat grid + repo table,
   wires a shared month-granularity time slider (synced across
   Leaderboard and Data Explorer tabs) + track chips + search.
============================================================= */

(function () {
  const DATA_INDEX = "data/index.json";
  const REPO_DIR = "data/repos";
  const TRACKS = ["test_update", "test_generation"];
  const TRACK_SHORT = { test_update: "u", test_generation: "g" };
  const SHORT_TRACK = { u: "test_update", g: "test_generation" };

  // Default left edge: March 2020
  const DEFAULT_MIN_MONTH = "2020-03";

  // --- state ---
  const state = {
    index: null,
    months: [],         // sorted unique months "YYYY-MM"
    minIdx: 0,
    maxIdx: 0,
    tracks: new Set(TRACKS),
    search: "",
    repoDetailCache: {},
    // Sorting. sortKey: 'tu' | 'tg' | 'total'; revSortDir: 'asc' | 'desc'
    sortKey: "total",
    sortDir: "desc",
    revSortDir: "asc",   // Date sort inside expanded rev-pair rows
  };

  /* ---------- utilities ---------- */

  function $(id) { return document.getElementById(id); }

  /** Convert "YYYY-MM" to a display string like "3/2020" */
  function monthDisplay(m) {
    if (!m) return "—";
    const [y, mm] = m.split("-");
    return `${parseInt(mm, 10)}/${y}`;
  }

  /** Convert "YYYY-MM" to first day of month "YYYY-MM-01" */
  function monthToFirstDay(m) { return m + "-01"; }

  /** Convert "YYYY-MM" to last day of month */
  function monthToLastDay(m) {
    const [y, mm] = m.split("-").map(Number);
    const d = new Date(y, mm, 0); // day 0 of next month = last day
    return `${y}-${String(mm).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** Check if a day "YYYY-MM-DD" falls within the current month window */
  function inWindow(day) {
    if (!day) return false;
    const lo = monthToFirstDay(state.months[state.minIdx]);
    const hi = monthToLastDay(state.months[state.maxIdx]);
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
    return parts.join(", ") || "< 1 month";
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

  /* ---------- month axis ---------- */

  function computeMonthAxis(idx) {
    const s = new Set();
    for (const r of idx.repos) {
      for (const rp of r.rev_pairs) {
        if (rp.d) s.add(rp.d.slice(0, 7)); // "YYYY-MM"
      }
    }
    return Array.from(s).sort();
  }

  /** Find index in state.months >= given month string */
  function findMonthIndex(monthStr) {
    let lo = 0, hi = state.months.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (state.months[mid] < monthStr) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /* ---------- shared time-window slider ---------- */

  // Both the leaderboard and explorer have their own slider DOM.
  // We keep them in sync: any change to one updates the other.

  const sliderSets = {
    lb: { range_min: "tw-range-min-lb", range_max: "tw-range-max-lb",
          input_min: "tw-input-min-lb", input_max: "tw-input-max-lb",
          active: "tw-active-lb", before: "tw-before-lb",
          ticks: "tw-ticks-lb", summary: "tw-summary-lb" },
    ex: { range_min: "tw-range-min-ex", range_max: "tw-range-max-ex",
          input_min: "tw-input-min-ex", input_max: "tw-input-max-ex",
          active: "tw-active-ex", before: "tw-before-ex",
          ticks: "tw-ticks-ex", summary: "tw-summary-ex" },
  };

  /** Count tasks in the current time window */
  function countTasksInWindow() {
    if (!state.index) return 0;
    let count = 0;
    for (const r of state.index.repos) {
      for (const rp of r.rev_pairs) {
        if (inWindow(rp.d)) count++;
      }
    }
    return count;
  }

  /** Update the visual state of one slider set */
  function syncSliderUI(ids) {
    const rmin = $(ids.range_min);
    const rmax = $(ids.range_max);
    const imin = $(ids.input_min);
    const imax = $(ids.input_max);
    const active = $(ids.active);
    const before = $(ids.before);
    const summary = $(ids.summary);

    if (!rmin || !rmax) return;

    const maxVal = state.months.length - 1;
    rmin.max = maxVal;
    rmax.max = maxVal;
    rmin.value = state.minIdx;
    rmax.value = state.maxIdx;

    // Date inputs
    if (imin) imin.value = monthToFirstDay(state.months[state.minIdx]);
    if (imax) imax.value = monthToLastDay(state.months[state.maxIdx]);

    const minPct = maxVal > 0 ? (state.minIdx / maxVal) * 100 : 0;
    const maxPct = maxVal > 0 ? (state.maxIdx / maxVal) * 100 : 100;

    // Track highlights
    if (before) {
      before.style.width = minPct + "%";
    }
    if (active) {
      active.style.left = minPct + "%";
      active.style.width = (maxPct - minPct) + "%";
    }

    // Summary text
    if (summary) {
      const taskCount = countTasksInWindow();
      const startDisp = monthDisplay(state.months[state.minIdx]);
      const endDisp = monthDisplay(state.months[state.maxIdx]);
      summary.innerHTML = `<strong>${fmtNum(taskCount)} tasks</strong> selected in the current time window (<strong>${startDisp}</strong> to <strong>${endDisp}</strong>). Adjust the start or end date to change the window.`;
    }
  }

  /** Sync all slider UIs to current state, re-render data */
  function syncAll() {
    for (const ids of Object.values(sliderSets)) {
      syncSliderUI(ids);
    }
    renderTable();
    if (window.TestEvoBench && window.TestEvoBench.renderLeaderboard) {
      window.TestEvoBench.renderLeaderboard();
    }
  }

  /** Render tick marks — auto-picks interval to avoid overlap */
  function renderTicks(ids) {
    const container = $(ids.ticks);
    if (!container || state.months.length === 0) return;
    container.innerHTML = "";

    const firstMonth = state.months[0];
    const lastMonth = state.months[state.months.length - 1];
    const firstDate = new Date(firstMonth + "-01");
    const lastDate = new Date(lastMonth + "-01");
    const totalSpan = lastDate.getTime() - firstDate.getTime();
    if (totalSpan <= 0) return;

    const startYear = firstDate.getFullYear();
    const endYear = lastDate.getFullYear();
    const yearSpan = endYear - startYear + 1;

    // Pick tick interval to keep labels readable:
    //   <= 4 years  → every 6 months  (label: "1/2024")
    //   <= 10 years → every year       (label: "2020")
    //   > 10 years  → every 2 years    (label: "2020")
    let stepMonths, labelFn;
    if (yearSpan <= 4) {
      stepMonths = 6;
      labelFn = (y, m) => `${m}/${y}`;
    } else if (yearSpan <= 10) {
      stepMonths = 12;
      labelFn = (y) => `${y}`;
    } else {
      stepMonths = 24;
      labelFn = (y) => `${y}`;
    }

    // Generate ticks
    // Start at the first Jan on or after firstDate
    let tickYear = startYear;
    let tickMonth = 1; // always start at January

    while (true) {
      const tickDate = new Date(tickYear, tickMonth - 1, 1);
      if (tickDate.getTime() > lastDate.getTime() + 365 * 86400000) break;

      if (tickDate >= firstDate) {
        const offset = tickDate.getTime() - firstDate.getTime();
        const pct = Math.max(0, Math.min(100, (offset / totalSpan) * 100));

        const tick = document.createElement("div");
        tick.className = "tw-tick";
        tick.style.left = pct + "%";
        const label = labelFn(tickYear, tickMonth);
        tick.innerHTML = `<div class="tw-tick-mark"></div><div class="tw-tick-label">${label}</div>`;
        container.appendChild(tick);
      }

      // Advance
      tickMonth += stepMonths;
      while (tickMonth > 12) {
        tickMonth -= 12;
        tickYear++;
      }
    }
  }

  /** Wire one slider set's event listeners */
  function wireSliderSet(ids, otherIds) {
    const rmin = $(ids.range_min);
    const rmax = $(ids.range_max);
    const imin = $(ids.input_min);
    const imax = $(ids.input_max);

    if (!rmin || !rmax) return;

    const handleRange = () => {
      let lo = parseInt(rmin.value, 10);
      let hi = parseInt(rmax.value, 10);
      if (lo > hi) [lo, hi] = [hi, lo];
      state.minIdx = lo;
      state.maxIdx = hi;
      syncAll();
    };

    rmin.addEventListener("input", handleRange);
    rmax.addEventListener("input", handleRange);

    // Date input handlers
    if (imin) {
      imin.addEventListener("change", () => {
        const val = imin.value; // "YYYY-MM-DD"
        if (!val) return;
        const monthStr = val.slice(0, 7);
        const idx = findMonthIndex(monthStr);
        state.minIdx = Math.min(idx, state.maxIdx);
        syncAll();
      });
    }
    if (imax) {
      imax.addEventListener("change", () => {
        const val = imax.value;
        if (!val) return;
        const monthStr = val.slice(0, 7);
        // Find the last month <= monthStr
        let idx = findMonthIndex(monthStr);
        // If the found month is > monthStr, go back one
        if (idx < state.months.length && state.months[idx] > monthStr && idx > 0) idx--;
        state.maxIdx = Math.max(idx, state.minIdx);
        syncAll();
      });
    }
  }

  function wireTimeSliders() {
    const maxVal = state.months.length - 1;
    const defaultMinIdx = findMonthIndex(DEFAULT_MIN_MONTH);

    state.minIdx = defaultMinIdx;
    state.maxIdx = maxVal;

    // Set initial range values
    for (const ids of Object.values(sliderSets)) {
      const rmin = $(ids.range_min);
      const rmax = $(ids.range_max);
      if (rmin) { rmin.min = 0; rmin.max = maxVal; }
      if (rmax) { rmax.min = 0; rmax.max = maxVal; }
    }

    // Wire events (each slider syncs with the other)
    wireSliderSet(sliderSets.lb, sliderSets.ex);
    wireSliderSet(sliderSets.ex, sliderSets.lb);

    // Set date input bounds
    const firstDay = monthToFirstDay(state.months[0]);
    const lastDay = monthToLastDay(state.months[maxVal]);
    for (const ids of Object.values(sliderSets)) {
      const imin = $(ids.input_min);
      const imax = $(ids.input_max);
      if (imin) { imin.min = firstDay; imin.max = lastDay; }
      if (imax) { imax.min = firstDay; imax.max = lastDay; }
    }

    // Render ticks
    for (const ids of Object.values(sliderSets)) {
      renderTicks(ids);
    }

    syncAll();
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
    // Sort by chosen column + direction
    const getVal = (f) => {
      if (state.sortKey === "tu") return f.tuTasks;
      if (state.sortKey === "tg") return f.tgTasks;
      return f.tuTasks + f.tgTasks;
    };
    const dir = state.sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => (getVal(a) - getVal(b)) * dir);

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">No repositories match the current filters.</td></tr>`;
      return;
    }

    for (const f of rows) {
      const r = f.row;
      const total = f.tuTasks + f.tgTasks;
      const tr = document.createElement("tr");
      tr.className = "repo-row";
      tr.dataset.project = r.project_name;
      tr.innerHTML = `
        <td class="col-expand"><span class="caret"></span></td>
        <td class="col-repo">
          <div class="repo-name">${escapeHtml(r.display_name || r.project_name)}</div>
          <div class="repo-sub">${escapeHtml(r.project_name)}</div>
        </td>
        <td class="col-num">${fmtNum(total)}</td>
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
    td.colSpan = 6;
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
    const dir = state.revSortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => (a.rp.rev2_date || "").localeCompare(b.rp.rev2_date || "") * dir);

    const dateArrow = state.revSortDir === "asc" ? "↑" : "↓";
    let html = `
      <table class="rev-table">
        <thead>
          <tr>
            <th class="rev-col-track">Track</th>
            <th class="rev-col-commit">Commit</th>
            <th class="rev-col-deps">Dependency method(s)</th>
            <th class="rev-col-methods">Test method(s)</th>
            <th class="rev-col-date sortable sort-active" data-rev-sort="date">Date<span class="sort-arrow">${dateArrow}</span></th>
          </tr>
        </thead>
        <tbody>
    `;
    for (const { track, rp } of rows) {
      const tagCls = track === "test_update" ? "tu" : "tg";
      // Show rev1...rev2 (short SHAs) as a link to the git diff URL
      const shortRev1 = rp.rev1 ? rp.rev1.slice(0, 7) : "—";
      const shortRev2 = rp.rev2 ? rp.rev2.slice(0, 7) : "—";
      const commitLabel = `${shortRev1}...${shortRev2}`;
      const commitHtml = rp.git_diff_url
        ? `<a class="diff-link" href="${escapeAttr(rp.git_diff_url)}" target="_blank" rel="noopener">${escapeHtml(commitLabel)}</a>`
        : escapeHtml(commitLabel);
      // Dependency methods — shown as class#method, linked to diff when URL available
      const depUrls = rp.dependency_method_urls || {};
      const depsHtml = (rp.dependency_methods || []).map(m => {
        const url = depUrls[m];
        const inner = url
          ? `<a class="diff-link" href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(m)}</a>`
          : escapeHtml(m);
        return `<div class="m" title="${escapeAttr(m)}">${inner}</div>`;
      }).join("") || '<div class="m metric-pending">—</div>';
      // Test methods — shown as test_class#test_method, linked to diff when URL available
      const testUrls = rp.test_method_urls || {};
      const methodsHtml = (rp.test_methods || []).map(m => {
        const url = testUrls[m];
        const inner = url
          ? `<a class="diff-link" href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(m)}</a>`
          : escapeHtml(m);
        return `<div class="m" title="${escapeAttr(m)}">${inner}</div>`;
      }).join("") || '<div class="m metric-pending">—</div>';
      html += `
        <tr>
          <td><span class="track-tag ${tagCls}">${track.replace("test_", "")}</span></td>
          <td class="rev-commit-cell">${commitHtml}</td>
          <td class="dep-methods-cell"><div class="dep-methods">${depsHtml}</div></td>
          <td class="test-methods-cell"><div class="test-methods">${methodsHtml}</div></td>
          <td>${escapeHtml(rp.rev2_date || "—")}</td>
        </tr>
      `;
    }
    html += `</tbody></table>`;
    return html;
  }

  /* ---------- sort headers ---------- */

  /** Update the arrow glyph + active class on the outer table headers */
  function syncSortHeaderUI() {
    const headers = document.querySelectorAll("#explorer-table thead th.sortable");
    headers.forEach(th => {
      const key = th.dataset.sort;
      const arrow = th.querySelector(".sort-arrow");
      if (key === state.sortKey) {
        th.classList.add("sort-active");
        if (arrow) arrow.textContent = state.sortDir === "asc" ? "↑" : "↓";
      } else {
        th.classList.remove("sort-active");
        if (arrow) arrow.textContent = "";
      }
    });
  }

  function wireSortHeaders() {
    // Outer explorer table: test update / test generation
    document.querySelectorAll("#explorer-table thead th.sortable").forEach(th => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.sortKey = key;
          state.sortDir = "desc";
        }
        // Collapse any expanded rows — they'll be out of order after re-render
        document.querySelectorAll("tr.rev-pair-row").forEach(r => r.remove());
        document.querySelectorAll("tr.repo-row.open").forEach(r => r.classList.remove("open"));
        syncSortHeaderUI();
        renderTable();
      });
    });

    // Inner rev-pair table: Date column (delegated — rows are dynamic)
    document.addEventListener("click", (e) => {
      const th = e.target.closest(".rev-table th.sortable[data-rev-sort='date']");
      if (!th) return;
      state.revSortDir = state.revSortDir === "asc" ? "desc" : "asc";
      // Re-render every currently-open rev-pair row
      document.querySelectorAll("tr.repo-row.open").forEach(async (tr) => {
        const repoName = tr.dataset.project;
        const next = tr.nextElementSibling;
        if (next && next.classList.contains("rev-pair-row")) {
          const td = next.querySelector("td");
          const detail = await loadRepoDetail(repoName);
          td.innerHTML = renderRevPairs(detail);
        }
      });
    });
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

  /* ---------- public state ---------- */

  window.TestEvoBench = window.TestEvoBench || {};
  window.TestEvoBench.getState = () => ({
    minDay: monthToFirstDay(state.months[state.minIdx]),
    maxDay: monthToLastDay(state.months[state.maxIdx]),
    months: state.months,
    tracks: new Set(state.tracks),
  });

  /* ---------- bootstrap ---------- */

  async function init() {
    try {
      const idx = await loadIndex();
      state.index = idx;
      state.months = computeMonthAxis(idx);
      if (state.months.length === 0) {
        state.months = ["2000-01"];
      }
      renderStats(idx);
      wireChipsAndSearch();
      wireSortHeaders();
      syncSortHeaderUI();
      wireTimeSliders();
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
