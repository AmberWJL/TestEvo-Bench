/* =============================================================
   TestEvo-Bench — filter.js  (Pipeline Filtering Explorer, v1.1)
   Loads data/filter/index.json; renders funnel tiles + bars, a
   filterable repo table (with a record-centric S5 mode), and lazy
   per-repo detail panels (data/filter/repos/<repo_name>.json).
============================================================= */

(function () {
  const IDX_URL = "data/filter/index.json";
  const REPO_DIR = "data/filter/repos";
  const S1C_URL = "data/filter/stage1_poolC_dropped.json";

  const STAGE_LABELS = { s1: "S1 Discover", s2: "S2 Qualify", s3: "S3 Build anchor",
                         s4: "S4 Mine commits", s5: "S5 Classify records" };
  const STATUS_LABEL = { kept: "kept", dropped: "dropped", in_flight: "in flight" };
  // v1.2 palette: kept-green + 7 categorical hues, validated for adjacent-pair
  // colorblind separation on the light surface; gray is the "other" fold.
  const KEPT_COLOR = "#2e7d32";
  const OTHER_COLOR = "#8a8a8a";
  const SEG_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7", "#e34948"];
  const SEG_DARK_TEXT = new Set(["#eda100", "#1baf7a", "#e87ba4"]);
  const ORD = { s1: 1, s2: 2, s3: 3, s4: 4, s5: 5 };
  const TRACK_SETS = { test_update_positive: "update track", test_generation_fail_error_old: "generation track" };

  const state = {
    index: null,
    pools: new Set(["A", "C"]),
    stage: "all",
    status: "all",
    reason: "all",
    search: "",
    sortKey: "rec", sortDir: "desc",
    cache: {}, s1c: null,
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmt(n) { return n == null ? "—" : Number(n).toLocaleString(); }
  function s5mode() { return state.stage === "s5"; }
  // Repo-level reason filter values are "stage|code": several pipeline steps
  // share a display label (S2 multimodule_check_failed vs S3 module_check_failed
  // are both "Module listing failed"), so options carry their stage and the
  // dropdown groups them under stage headings.  S5 mode keeps bare codes.
  function reasonParts(val) {
    const i = val.indexOf("|");
    return i < 0 ? [null, val] : [val.slice(0, i), val.slice(i + 1)];
  }

  function reasonLabel(code) {
    if (!code) return "";
    if (code === "__other__") return "Other reasons";
    const r = state.index.reasons[code];
    if (r) return r.label;
    if (code.startsWith("not discriminating")) return "Not discriminating";
    if (code.startsWith("excluded_2019w:")) return "Excluded (decided in all-run)";
    return code;
  }
  function reasonExplanation(code) {
    const r = state.index.reasons[code];
    return r ? r.explanation : "";
  }

  /* ---------- stable reason colors ---------- */
  // "stage|code" -> hex, assigned ONCE from the combined A+C drop-count ordering,
  // so toggling pools or filters never repaints a reason.
  const COLOR = {};
  function buildColorMap() {
    const f = state.index.funnel;
    for (const st of ["s2", "s3", "s4"]) {
      const agg = {};
      for (const p of ["A", "C"]) {
        const fs = (f[p] || {})[st];
        for (const [k, v] of Object.entries((fs && fs.dropped) || {})) agg[k] = (agg[k] || 0) + v;
      }
      Object.entries(agg).sort((a, b) => b[1] - a[1]).forEach(([k], i) => {
        COLOR[st + "|" + k] = i < SEG_COLORS.length ? SEG_COLORS[i] : OTHER_COLOR;
      });
    }
    Object.entries((f.s5 || {}).dropped_by_reason || {}).sort((a, b) => b[1] - a[1]).forEach(([k], i) => {
      COLOR["s5|" + k] = i < SEG_COLORS.length ? SEG_COLORS[i] : OTHER_COLOR;
    });
  }
  function segColor(st, code) { return COLOR[st + "|" + code] || OTHER_COLOR; }

  // Segments shown individually are the stage's combined-top-7 reasons (the ones
  // with a stable non-gray color); the rest fold into "__other__" — unless the
  // fold would hold a single reason, which is then shown on its own.
  function foldEntries(stage, entries) {
    const shown = [], folded = [];
    for (const [code, n] of entries) (segColor(stage, code) === OTHER_COLOR ? folded : shown).push([code, n]);
    if (folded.length === 1) shown.push(folded[0]);
    const segs = shown.map(([code, n]) => ({
      code, n, color: segColor(stage, code), title: reasonLabel(code), expl: reasonExplanation(code) }));
    if (folded.length > 1) {
      segs.push({ code: "__other__", n: folded.reduce((s, e) => s + e[1], 0),
                  color: OTHER_COLOR, title: "other reasons (" + folded.length + ")", expl: "" });
    }
    segs.sort((a, b) => b.n - a.n);
    return segs;
  }

  // The segment key ("stage|code") the current filter state highlights, if any.
  function activeSegKey() {
    if (state.reason !== "all") {
      if (s5mode()) return "s5|" + state.reason;
      const [rst, rrc] = reasonParts(state.reason);
      return rst ? rst + "|" + rrc : null;
    }
    if (state.status === "survived" && state.stage !== "all") return state.stage + "|__kept__";
    if (state.status === "kept" && s5mode()) return "s5|__kept__";
    return null;
  }

  /* ---------- filtering ---------- */

  function rowVisible(r) {
    if (!state.pools.has(r.p)) return false;
    // "survived" = passed the selected stage, i.e. its journey was decided later
    // (or it was kept outright). Skips the decided-at-stage equality check.
    const survived = state.status === "survived" && state.stage !== "all";
    if (state.stage !== "all" && !survived && r.st !== state.stage) return false;
    if (survived) {
      if (!(ORD[r.st] > ORD[state.stage] || r.o === "kept")) return false;
    } else if (state.status === "survived") {
      if (r.o !== "kept") return false;                         // stage=all: degrade to kept
    } else if (state.status !== "all" && r.o !== state.status) return false;
    if (state.reason !== "all") {
      if (s5mode()) {
        if (state.reason === "__other__") {
          if (!r.rd || !Object.entries(r.rd).some(([c, v]) => v > 0 && segColor("s5", c) === OTHER_COLOR)) return false;
        } else if (!r.rd || !(r.rd[state.reason] > 0)) return false;   // ≥1 record dropped for it
      } else {
        const [rst, rrc] = reasonParts(state.reason);
        if (rrc === "__other__") {
          if ((rst && r.st !== rst) || !r.rc || segColor(rst || r.st, r.rc) !== OTHER_COLOR) return false;
        } else if ((rst && r.st !== rst) || r.rc !== rrc) return false;
      }
    }
    if (state.search) {
      const q = state.search.toLowerCase();
      if (!r.r.toLowerCase().includes(q) && !(r.d || "").toLowerCase().includes(q)) return false;
    }
    return true;
  }

  /* ---------- header: snapshot + tiles + funnel bars ---------- */

  function renderSnapshot() {
    const s = state.index.snapshot;
    $("flt-snapshot").innerHTML =
      `Snapshot <strong>${esc(s.suffix)}</strong> · generated ${esc(state.index.generated_at)}` +
      ` · internal commit <code>${esc(s.internal_commit)}</code>` +
      ` · ${fmt(s.stage4_population)} anchors · ${fmt(s.jsonl_files)} repos with records · ${fmt(s.records)} records`;
  }

  function stageTileData() {
    const f = state.index.funnel;
    const pools = [...state.pools];
    const agg = (stage, key) => pools.reduce((n, p) => {
      const v = (f[p] && f[p][stage]) ? f[p][stage][key] : null;
      return v == null ? n : n + v;
    }, 0);
    const s5 = f.s5 || {};
    return [
      { id: "s1", main: pools.map(p => `${fmt((f[p].s1 || {}).kept)} ${p}`).join(" · "),
        sub: state.pools.has("C") ? `Pool C examined ${fmt((f.C.s1 || {}).in)}` : "search universe not recorded" },
      { id: "s2", main: `${fmt(agg("s2", "in"))} → ${fmt(agg("s2", "kept"))}`, sub: "license · clone · pom · modules" },
      { id: "s3", main: `${fmt(agg("s3", "in"))} → ${fmt(agg("s3", "kept"))}`, sub: "anchor build gate" },
      { id: "s4", main: `${fmt(agg("s4", "in"))} → ${fmt(agg("s4", "kept"))}`, sub: "commit mining window" },
      { id: "s5", main: `${fmt(s5.records)} → ${fmt(s5.classified)}`,
        sub: `tasks: ${fmt(((s5.tracks || {}).test_update || {}).tasks)} update · ${fmt(((s5.tracks || {}).test_generation || {}).tasks)} generation` },
    ];
  }

  function renderTiles() {
    const grid = $("flt-tiles");
    grid.innerHTML = "";
    for (const t of stageTileData()) {
      const d = document.createElement("div");
      d.className = "stat flt-tile" + (state.stage === t.id ? " flt-tile-active" : "");
      d.innerHTML = `<div class="label">${esc(STAGE_LABELS[t.id])}</div>` +
        `<div class="value flt-tile-value">${t.main}</div><div class="sub">${esc(t.sub)}</div>`;
      d.addEventListener("click", () => {
        setStage(state.stage === t.id ? "all" : t.id);
      });
      grid.appendChild(d);
    }
  }

  function segButton(stage, code, color, n, total, tip, tipx, title, unit) {
    const active = activeSegKey();
    const key = stage + "|" + code;
    let cls = "flt-seg";
    if (code === "__kept__") cls += " flt-seg-kept";
    if (active) cls += active === key ? " flt-selected" : " flt-dimmed";
    const pct = total ? n * 100 / total : 0;
    const lab = pct >= 14
      ? `<span class="flt-seg-label" style="color:${SEG_DARK_TEXT.has(color) ? "#1a1a1a" : "#fff"}">${esc(title)} ${Math.round(pct)}%</span>`
      : "";
    return `<button type="button" class="${cls}" style="flex:${n};background:${color}"` +
      ` data-tip="${esc(tip)}"${tipx ? ` data-tipx="${esc(tipx)}"` : ""}` +
      ` data-fstage="${stage}" data-fcode="${esc(code)}"` +
      ` aria-label="${esc(title)}: ${fmt(n)} ${unit} — click to filter">${lab}</button>`;
  }

  function funnelRowHtml(stage, label, kept, total, dropEntries, keptTip, unit, keptTitle) {
    let html = `<div class="flt-funnel-row"><div class="flt-funnel-label">${esc(label)}</div><div class="flt-funnel-bar">`;
    html += segButton(stage, "__kept__", KEPT_COLOR, kept, total, keptTip, "", keptTitle, unit);
    for (const g of foldEntries(stage, dropEntries)) {
      const tip = `${g.title}: ${fmt(g.n)} ${unit} (${Math.round(g.n * 100 / total)}%)`;
      html += segButton(stage, g.code, g.color, g.n, total, tip, g.expl, g.title, unit);
    }
    html += `</div><div class="flt-funnel-note">${fmt(total)} → ${fmt(kept)} ${esc(unit)}</div></div>`;
    return html;
  }

  function renderFunnelBar() {
    const wrap = $("flt-funnel");
    wrap.innerHTML = "";
    const f = state.index.funnel;
    const pools = [...state.pools];
    for (const stage of ["s2", "s3", "s4"]) {
      const drops = {};
      let kept = 0, total = 0;
      for (const p of pools) {
        const fs = (f[p] || {})[stage];
        if (!fs) continue;
        kept += fs.kept || 0;
        total += (fs.in || 0);
        for (const [k, v] of Object.entries(fs.dropped || {})) drops[k] = (drops[k] || 0) + v;
      }
      if (!total) continue;
      const entries = Object.entries(drops).sort((a, b) => b[1] - a[1]);
      wrap.insertAdjacentHTML("beforeend", funnelRowHtml(
        stage, STAGE_LABELS[stage], kept, total, entries,
        `Kept: ${fmt(kept)} repos (${Math.round(kept * 100 / total)}%) — click for the survivors`,
        "repos", "kept"));
    }
    // S5 — record-level, global (pool chips do not apply)
    const s5 = f.s5;
    if (s5 && s5.records) {
      const cbs = s5.classified_by_set || {};
      const trackN = Object.keys(TRACK_SETS).reduce((n, k) => n + (cbs[k] || 0), 0);
      const keptTip = `Classified: ${fmt(s5.classified)} records (${Math.round(s5.classified * 100 / s5.records)}%)` +
        ` — tracks ${fmt(trackN)}, other sets ${fmt(s5.classified - trackN)}`;
      const entries = Object.entries(s5.dropped_by_reason || {}).sort((a, b) => b[1] - a[1]);
      wrap.insertAdjacentHTML("beforeend", funnelRowHtml(
        "s5", STAGE_LABELS.s5 + " *", s5.classified, s5.records, entries, keptTip, "records", "classified"));
      wrap.insertAdjacentHTML("beforeend",
        `<div class="flt-funnel-foot">* the S5 bar counts <strong>records</strong> (test-method changes) across all kept repos, not repositories; pool filters do not apply to it.</div>`);
    }
  }

  /* ---------- click-to-filter ---------- */

  // Move stage, reason and status in one step (setStage would reset the reason
  // on an s5 mode switch before we could apply it).
  function setFilterTo(stage, reason, status) {
    const wasS5 = s5mode();
    state.stage = stage;
    if (s5mode() !== wasS5) { state.sortKey = "rec"; state.sortDir = "desc"; }
    state.reason = reason;
    state.status = status;
    if (s5mode() && reason !== "all") { state.sortKey = "rsel"; state.sortDir = "desc"; }
    renderAll();
  }

  function onSegClick(el) {
    const st = el.dataset.fstage, code = el.dataset.fcode;
    if (!st || !code) return;
    if (activeSegKey() === st + "|" + code) { setFilterTo("all", "all", "all"); return; }   // toggle off
    if (code === "__kept__") setFilterTo(st, "all", st === "s5" ? "kept" : "survived");
    else setFilterTo(st, st === "s5" ? code : st + "|" + code, "all");
  }

  /* ---------- reason dropdown ---------- */

  function renderReasonOptions() {
    const counts = {};
    if (s5mode()) {
      for (const r of state.index.repos) {
        if (!state.pools.has(r.p) || !r.rd) continue;
        for (const [code, n] of Object.entries(r.rd)) counts[code] = (counts[code] || 0) + n;
      }
    } else {
      for (const r of state.index.repos) {
        if (!state.pools.has(r.p)) continue;
        if (r.rc) {
          const k = `${r.st}|${r.rc}`;
          counts[k] = (counts[k] || 0) + 1;
        }
      }
      if (state.stage === "s1" && state.pools.has("C")) {
        const d = ((state.index.funnel.C || {}).s1 || {}).dropped || {};
        for (const [code, n] of Object.entries(d)) counts[`s1|${code}`] = n;
      }
    }
    const sel = $("flt-reason");
    const cur = state.reason;
    sel.innerHTML = `<option value="all">${s5mode() ? "All record-drop reasons" : "All reasons"}</option>`;
    if (s5mode()) {
      for (const [code, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        const o = document.createElement("option");
        o.value = code;
        o.textContent = `${reasonLabel(code)} (${fmt(n)} records)`;
        sel.appendChild(o);
      }
    } else {
      // flat list, count-desc, each label prefixed with its stage ("S3 - …")
      for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        const [st, code] = reasonParts(k);
        const o = document.createElement("option");
        o.value = k;
        o.textContent = `${st.toUpperCase()} - ${reasonLabel(code)} (${fmt(n)})`;
        sel.appendChild(o);
      }
    }
    const isOther = cur !== "all" && (s5mode() ? cur === "__other__" : cur.endsWith("|__other__"));
    if (!counts[cur] && isOther) {
      // synthesize the fold option so a clicked "other" segment stays representable
      let st, n = 0;
      if (s5mode()) {
        st = "s5";
        for (const r of state.index.repos) {
          if (!state.pools.has(r.p) || !r.rd) continue;
          if (Object.entries(r.rd).some(([c, v]) => v > 0 && segColor("s5", c) === OTHER_COLOR)) n++;
        }
      } else {
        st = reasonParts(cur)[0];
        for (const r of state.index.repos)
          if (state.pools.has(r.p) && r.st === st && r.rc && segColor(st, r.rc) === OTHER_COLOR) n++;
      }
      const o = document.createElement("option");
      o.value = cur;
      o.textContent = `${st.toUpperCase()} - Other reasons (${fmt(n)})`;
      sel.appendChild(o);
      sel.value = cur;
      return;
    }
    sel.value = counts[cur] ? cur : "all";
    if (!counts[cur] && cur !== "all") state.reason = "all";
  }

  /* ---------- outer table ---------- */

  const HEADS = {
    default: [
      ["", null, "col-expand"], ["Repository", "name", "col-repo"], ["Pool", null, ""],
      ["Stage", "stage", ""], ["Status", null, ""], ["Reason", null, ""],
      ["Records", "rec", "col-num"], ["Tasks", "tsk", "col-num"]],
    s5: [
      ["", null, "col-expand"], ["Repository", "name", "col-repo"], ["Pool", null, ""],
      ["Records", "rec", "col-num"], ["Classified", "cls", "col-num"],
      ["Dropped", "drop", "col-num"], ["Drop reason", "rsel", ""], ["Tasks", "tsk", "col-num"]],
  };

  function renderHead() {
    const cols = s5mode() ? HEADS.s5 : HEADS.default;
    const thead = document.querySelector("#flt-table thead");
    thead.innerHTML = "<tr>" + cols.map(([label, key, cls]) => {
      const sortable = key ? " sortable" : "";
      const arrow = key === state.sortKey ? (state.sortDir === "asc" ? "↑" : "↓") : "";
      const data = key ? ` data-sort="${key}"` : "";
      return `<th class="${cls}${sortable}"${data}>${esc(label)}${key ? `<span class="sort-arrow">${arrow}</span>` : ""}</th>`;
    }).join("") + "</tr>";
  }

  function sortVal(r) {
    const s5 = (r.s && r.s.s5) || {};
    switch (state.sortKey) {
      case "name": return r.r.toLowerCase();
      case "stage": return r.st;
      case "rec": return (r.c && r.c.rec) || 0;
      case "tsk": return (r.c && r.c.tsk) || 0;
      case "cls": return s5.classified || 0;
      case "drop": return s5.dropped || 0;
      case "rsel": return state.reason !== "all" ? ((r.rd || {})[state.reason] || 0)
                                                 : topDrop(r)[1];
      default: return 0;
    }
  }

  function topDrop(r) {
    let best = ["", 0];
    for (const [k, v] of Object.entries(r.rd || {})) if (v > best[1]) best = [k, v];
    return best;
  }

  function renderTable() {
    renderHead();
    const tbody = $("flt-tbody");
    tbody.innerHTML = "";
    if (state.stage === "s1") { renderStage1(tbody); return; }
    const rows = state.index.repos.filter(rowVisible);
    const dir = state.sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => (sortVal(a) < sortVal(b) ? -1 : sortVal(a) > sortVal(b) ? 1 : 0) * dir);
    $("flt-count").textContent = s5mode()
      ? `${fmt(rows.length)} repositories with records` +
        (state.reason !== "all" ? ` losing ≥1 record to “${reasonLabel(state.reason)}”` : "")
      : `${fmt(rows.length)} repositories match`;
    if (!rows.length) {
      let msg = "No repositories match the current filters.";
      if (state.status === "kept" && ["s2", "s3", "s4"].includes(state.stage)) {
        msg = "Empty by design: the Stage column shows where a repository's journey was DECIDED, " +
              "so a repo listed at S2–S4 is one that was dropped (or stalled) there. Kept repositories " +
              "were decided at S5 — choose Stage “S5 Classify records” (or “All stages”) to see them.";
      }
      tbody.innerHTML = `<tr><td colspan="8" class="empty">${msg}</td></tr>`;
      return;
    }
    for (const r of rows.slice(0, 1500)) {
      const tr = document.createElement("tr");
      tr.className = "repo-row";
      tr.dataset.repo = r.r;
      tr.innerHTML = s5mode() ? s5RowHtml(r) : defaultRowHtml(r);
      tr.addEventListener("click", () => toggleRow(tr, r));
      tbody.appendChild(tr);
    }
    if (rows.length > 1500) {
      tbody.insertAdjacentHTML("beforeend",
        `<tr><td colspan="8" class="empty">…and ${fmt(rows.length - 1500)} more — narrow the filters.</td></tr>`);
    }
  }

  function repoCellHtml(r) {
    return `<td class="col-expand"><span class="caret"></span></td>` +
      `<td class="col-repo"><div class="repo-name">${esc(r.d || r.r)}</div><div class="repo-sub">${esc(r.r)}</div></td>` +
      `<td>${esc(r.p)}</td>`;
  }

  function defaultRowHtml(r) {
    const pill = `<span class="flt-pill flt-${esc(r.o)}">${esc(STATUS_LABEL[r.o] || r.o)}</span>`;
    const badge = (r.s && r.s.s4 && String(r.s.s4).startsWith("excluded_2019w:"))
      ? ` <span class="flt-badge" title="outcome inherited from the earlier all-run (500-commit cap, no window)">all-run</span>` : "";
    const lc = r.lc ? ` <span class="flt-likely" title="heuristic, derived from the build log">likely: ${esc(r.lc.replace(/_/g, " "))}</span>` : "";
    return repoCellHtml(r) +
      `<td>${esc((STAGE_LABELS[r.st] || r.st).split(" ")[0])}</td>` +
      `<td>${pill}${badge}</td>` +
      `<td class="flt-reason-cell">${r.rc ? esc(reasonLabel(r.rc)) : "—"}${lc}</td>` +
      `<td class="col-num">${fmt(r.c && r.c.rec)}</td>` +
      `<td class="col-num">${fmt(r.c && r.c.tsk)}</td>`;
  }

  function s5RowHtml(r) {
    const s5 = (r.s && r.s.s5) || {};
    let reasonCell;
    if (state.reason !== "all") {
      const n = state.reason === "__other__"
        ? Object.entries(r.rd || {}).reduce((acc, [c, v]) => acc + (segColor("s5", c) === OTHER_COLOR ? v : 0), 0)
        : (r.rd || {})[state.reason] || 0;
      reasonCell = `<span title="${esc(reasonExplanation(state.reason))}">${esc(reasonLabel(state.reason))} <strong>×${fmt(n)}</strong></span>`;
    } else {
      const [code, n] = topDrop(r);
      reasonCell = code
        ? `<span title="${esc(reasonExplanation(code))}">${esc(reasonLabel(code))} <strong>×${fmt(n)}</strong></span>`
        : "—";
    }
    return repoCellHtml(r) +
      `<td class="col-num">${fmt(s5.records)}</td>` +
      `<td class="col-num">${fmt(s5.classified)}</td>` +
      `<td class="col-num">${fmt(s5.dropped)}</td>` +
      `<td class="flt-reason-cell">${reasonCell}</td>` +
      `<td class="col-num">${fmt(r.c && r.c.tsk)}</td>`;
  }

  async function renderStage1(tbody) {
    if (state.status === "kept" || state.status === "in_flight") {
      tbody.innerHTML = `<tr><td colspan="8" class="empty">Every Stage-1 row is a dropped candidate — repositories that passed Stage 1 continue to Stage 2 and appear under the later stages. Set Status to “All”/“Dropped” to see them.</td></tr>`;
      $("flt-count").textContent = "0 repositories match";
      return;
    }
    if (!state.pools.has("C")) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty">Stage-1 drops were recorded only for Pool C (100–299★). The Pool-A search universe was never persisted.</td></tr>`;
      return;
    }
    if (!state.s1c) {
      tbody.innerHTML = `<tr><td colspan="8" class="loading">Loading Stage-1 Pool-C drops…</td></tr>`;
      const res = await fetch(S1C_URL, { cache: "no-cache" });
      state.s1c = res.ok ? await res.json() : [];
    }
    let rows = state.s1c;
    if (state.search) {
      const q = state.search.toLowerCase();
      rows = rows.filter(x => x.f.toLowerCase().includes(q));
    }
    if (state.reason !== "all") {
      const code = reasonParts(state.reason)[1];
      if (code === "inactive" || code === "not_maven") rows = rows.filter(x => x.why === code);
    }
    $("flt-count").textContent = `${fmt(rows.length)} Pool-C candidates dropped at Stage 1`;
    tbody.innerHTML = "";
    for (const x of rows.slice(0, 1500)) {
      tbody.insertAdjacentHTML("beforeend",
        `<tr class="repo-row"><td></td>` +
        `<td class="col-repo"><div class="repo-name"><a class="diff-link" target="_blank" rel="noopener" href="https://github.com/${esc(x.f)}">${esc(x.f)}</a></div></td>` +
        `<td>C</td><td>S1</td><td><span class="flt-pill flt-dropped">dropped</span></td>` +
        `<td>${esc(reasonLabel(x.why))}${x.why === "inactive" ? ` (${fmt(x.act)} commits/12 mo)` : ""}</td>` +
        `<td class="col-num">${fmt(x.stars)}★</td><td class="col-num">—</td></tr>`);
    }
    if (rows.length > 1500) {
      tbody.insertAdjacentHTML("beforeend",
        `<tr><td colspan="8" class="empty">…and ${fmt(rows.length - 1500)} more — use the search box.</td></tr>`);
    }
  }

  /* ---------- detail panel ---------- */

  async function toggleRow(tr, r) {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains("flt-detail-row") && next.dataset.for === r.r) {
      next.remove(); tr.classList.remove("open"); return;
    }
    document.querySelectorAll("tr.flt-detail-row").forEach(x => x.remove());
    document.querySelectorAll("#flt-table tr.repo-row.open").forEach(x => x.classList.remove("open"));
    tr.classList.add("open");
    const dtr = document.createElement("tr");
    dtr.className = "flt-detail-row";
    dtr.dataset.for = r.r;
    const td = document.createElement("td");
    td.colSpan = 8;
    td.innerHTML = `<div class="loading">Loading detail…</div>`;
    dtr.appendChild(td);
    tr.parentNode.insertBefore(dtr, tr.nextSibling);
    if (!r.hd) { td.innerHTML = detailHeaderHtml(r, null) + `<div class="empty">No further detail was recorded for this repository.</div>`; return; }
    try {
      let det = state.cache[r.r];
      if (!det) {
        const res = await fetch(`${REPO_DIR}/${encodeURIComponent(r.r)}.json`, { cache: "no-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        det = await res.json();
        state.cache[r.r] = det;
      }
      const stagesHtml = r.o === "kept" ? keptStageLineHtml(det) : stageTimelineHtml(det);
      td.innerHTML = detailHeaderHtml(r, det) + stagesHtml + commitsHtml(det) + recordsHtml(det);
    } catch (e) {
      td.innerHTML = `<div class="empty">Failed to load detail: ${esc(e.message)}</div>`;
    }
  }

  function detailHeaderHtml(r, det) {
    const gh = det && det.github_url
      ? ` · <a class="diff-link" target="_blank" rel="noopener" href="${esc(det.github_url)}">GitHub</a>` : "";
    const stars = det && det.stars != null ? ` · ${fmt(det.stars)}★` : "";
    return `<div class="flt-det-head"><strong>${esc(r.d || r.r)}</strong> · pool ${esc(r.p)}${stars}${gh}</div>`;
  }

  function noteHtml(n) {
    const info = state.index.reasons[n];
    return `<span class="flt-note" title="${esc(info ? info.explanation : "")}">${esc(info ? info.label : n)}</span>`;
  }

  // Kept repos passed S2-S4: one compact line instead of three card blocks,
  // keeping the informative note badges (F36 recovery, salvage, ...).
  function keptStageLineHtml(det) {
    const parts = [];
    for (const st of det.stages || []) {
      let s = `<strong>${esc((STAGE_LABELS[st.id] || st.id).split(" ")[0])}</strong> ${esc(reasonLabel(st.outcome))} ✓`;
      if (st.test_count != null) s += ` <span class="flt-dim">(${fmt(st.test_count)} test classes)</span>`;
      parts.push(s);
    }
    let html = `<div class="flt-keptline">${parts.join('<span class="flt-dim"> · </span>')}`;
    for (const st of det.stages || []) (st.notes || []).forEach(n => { html += " " + noteHtml(n); });
    const s4 = (det.stages || []).find(s => s.id === "s4");
    if (s4 && s4.ledger_outcome) {
      html += ` <span class="flt-dim">· run ledger: ${esc(reasonLabel(s4.ledger_outcome))} — reconciliation pending</span>`;
    }
    return html + `</div>`;
  }

  function stageTimelineHtml(det) {
    let html = `<div class="flt-timeline">`;
    for (const st of det.stages || []) {
      const kept = st.outcome === "success" || st.outcome === "built";
      html += `<div class="flt-stage-block">`;
      html += `<div class="flt-stage-title">${esc(STAGE_LABELS[st.id] || st.id)} ` +
        `<span class="flt-pill ${kept ? "flt-kept" : "flt-dropped"}">${esc(reasonLabel(st.outcome))}</span>`;
      if (st.sub_reason) html += ` <span class="flt-pill flt-sub">${esc(reasonLabel(st.sub_reason))}</span>`;
      if (st.decided_in === "all-run") html += ` <span class="flt-badge">all-run</span>`;
      if (st.likely_cause_label) html += ` <span class="flt-likely" title="heuristic, derived from the build log">likely: ${esc(st.likely_cause_label)}</span>`;
      (st.notes || []).forEach(n => { html += " " + noteHtml(n); });
      html += `</div>`;
      const expl = reasonExplanation(st.sub_reason || st.outcome);
      if (expl && !kept) html += `<p class="dbg-explanation">${esc(expl)}</p>`;
      const meta = [];
      if (st.stage_step) meta.push(`step: ${esc(st.stage_step)}`);
      if (st.commit && st.commit !== "unknown") meta.push(`commit: <code>${esc(String(st.commit).slice(0, 10))}</code>`);
      if (st.test_count != null) meta.push(`${fmt(st.test_count)} test classes`);
      if (Array.isArray(st.attempts)) {
        meta.push(`${st.attempts.length} attempts: ` +
          st.attempts.map(a => `${esc(a.reason)} <span class="flt-dim">(${esc((a.ts || "").slice(0, 16))})</span>`).join(" → "));
      } else if (st.attempts != null) {
        meta.push(`${fmt(st.attempts)} dispatch attempt${st.attempts === 1 ? "" : "s"}`);
      }
      if (st.ledger_outcome) meta.push(`run ledger: ${esc(reasonLabel(st.ledger_outcome))} <span class="flt-dim">(reconciliation pending)</span>`);
      if (st.vm) meta.push(`vm: ${esc(st.vm)}`);
      if (st.duration_s != null) meta.push(`${Math.round(st.duration_s / 60)} min`);
      if (st.detail && st.detail.license) meta.push(`license: ${esc(st.detail.license)}`);
      if (meta.length) html += `<div class="flt-meta">${meta.join(" · ")}</div>`;
      if (st.error_message && !st.excerpt) html += excerptHtml(st.error_message);
      if (st.excerpt) html += excerptHtml(st.excerpt);
      html += `</div>`;
    }
    return html + `</div>`;
  }

  function excerptHtml(text) {
    return `<div class="dbg-log"><div class="dbg-log-inner"><pre>${esc(text)}</pre></div></div>`;
  }

  function commitsHtml(det) {
    const c = det.commits;
    if (!c || c.window == null) return "";
    const fin = c.finalisation || {};
    const parts = [
      `${fmt(c.window)} java commits in window`, `${fmt(c.selected)} selected`,
      `${fmt(c.builds_ok)} built / ${fmt(c.builds_failed)} failed`,
      `${fmt(c.candidates)} candidate pairs`, `${fmt(fin.kept)} kept`,
    ];
    const ps = det.pairs_summary;
    if (ps && ps.diff_pairs != null) parts.push(`${fmt(ps.diff_pairs)} diff pairs`);
    let html = `<div class="flt-commitline"><strong>Commit funnel:</strong> ${parts.join(" → ")}</div>`;
    const fr = Object.entries(c.failed_reasons || {}).sort((a, b) => b[1] - a[1]);
    if (fr.length) {
      html += `<div class="flt-meta">failed commit builds: ` +
        fr.map(([k, v]) => `${esc(reasonLabel(k))} ×${v}`).join(", ") + `</div>`;
    }
    return html;
  }

  function recordsHtml(det) {
    const rf = det.record_filters;
    if (!rf) return "";
    let html = `<div class="flt-stage-block"><div class="flt-stage-title">Records ` +
      `<span class="flt-pill flt-kept">${fmt(rf.records)} records</span></div>`;
    const kept = Object.entries(rf.kept || {}).sort((a, b) => b[1] - a[1]);
    if (kept.length) {
      html += `<div class="flt-meta">kept: ` + kept.map(([k, v]) =>
        `<span title="${esc(reasonExplanation(k))}">${esc(reasonLabel(k))} <strong>${fmt(v)}</strong></span>`).join(" · ") + `</div>`;
    }
    const drops = Object.entries(rf.dropped || {}).sort((a, b) => b[1] - a[1]);
    if (drops.length) {
      html += `<table class="rev-table flt-drops"><thead><tr><th>Dropped because</th><th>Records</th><th>Examples</th></tr></thead><tbody>`;
      for (const [reason, n] of drops) {
        const samples = (rf.samples || {})[reason] || [];
        const ex = samples.map(s => {
          const label = `${esc(s.test_file.split("/").pop())}#${esc(s.method.split("#")[1] || s.method)} @${esc(s.rev2)}`;
          return s.url ? `<a class="diff-link" target="_blank" rel="noopener" href="${esc(s.url)}">${label}</a>` : label;
        }).join(", ");
        html += `<tr><td title="${esc(reasonExplanation(reason))}">${esc(reasonLabel(reason))}</td>` +
          `<td class="col-num">${fmt(n)}</td><td class="flt-samples">${ex || "—"}</td></tr>`;
      }
      html += `</tbody></table>`;
    }
    const tg = rf.tasks || {};
    html += `<div class="flt-meta">tasks: test update <strong>${fmt(tg.test_update)}</strong> · ` +
      `test generation <strong>${fmt(tg.test_generation)}</strong></div></div>`;
    return html;
  }

  /* ---------- pipeline sankey ---------- */

  const SK = { W: 1000, x: [26, 318, 610, 884], nodeW: 11, top: 26, scaleH: 352, stubDX: 148, stubGap: 26 };

  function skPath(x0, y0, h0, x1, y1, h1) {
    const xm = (x0 + x1) / 2;
    return `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + h1} ` +
           `C${xm},${y1 + h1} ${xm},${y0 + h0} ${x0},${y0 + h0} Z`;
  }
  function stageIO(st) {
    let inn = 0, kept = 0;
    for (const p of state.pools) {
      const fs = (state.index.funnel[p] || {})[st];
      if (fs) { inn += fs.in || 0; kept += fs.kept || 0; }
    }
    return { in: inn, kept };
  }
  function stageDropsCombined(st) {
    const agg = {};
    for (const p of state.pools)
      for (const [k, v] of Object.entries(((state.index.funnel[p] || {})[st] || {}).dropped || {}))
        agg[k] = (agg[k] || 0) + v;
    return Object.entries(agg).sort((a, b) => b[1] - a[1]);
  }

  function renderS1Lead() {
    const el = $("flt-sk-lead");
    if (!el) return;
    const c1 = (state.index.funnel.C || {}).s1 || {};
    el.innerHTML = state.pools.has("C")
      ? `Stage 1 (not to scale): Pool C examined <span class="flt-sk-num">${fmt(c1.in)}</span> candidates → kept ` +
        `<span class="flt-sk-num">${fmt(c1.kept)}</span> (${fmt((c1.dropped || {}).inactive)} inactive · ` +
        `${fmt((c1.dropped || {}).not_maven)} not Maven). Pool A’s search universe was not recorded.`
      : `Stage 1: Pool A’s search universe was not recorded — only its ` +
        `${fmt(((state.index.funnel.A || {}).s1 || {}).kept)} Maven survivors enter Stage 2.`;
  }

  function renderSankey() {
    const wrap = $("flt-sankey");
    if (!wrap) return;
    renderS1Lead();
    const io = { s2: stageIO("s2"), s3: stageIO("s3"), s4: stageIO("s4") };
    if (!io.s2.in) { wrap.innerHTML = `<p class="flt-sk-lead">Select at least one pool to draw the funnel.</p>`; return; }
    const px = SK.scaleH / io.s2.in;
    const stages = ["s2", "s3", "s4"];
    const H = Math.max(...stages.map(st =>
      SK.top + io[st].in * px + SK.stubGap + (io[st].in - io[st].kept) * px + 64)) + 10;
    const active = activeSegKey();
    let s = `<svg class="flt-sk" viewBox="0 0 ${SK.W} ${Math.max(Math.ceil(H), 300)}" role="img"` +
            ` aria-label="Repository pipeline flow by stage and drop reason">`;
    // stage nodes + headers
    stages.forEach((st, i) => {
      s += `<rect class="flt-sk-node" x="${SK.x[i]}" y="${SK.top}" width="${SK.nodeW}"` +
           ` height="${Math.max(io[st].in * px, 2)}" rx="2"></rect>`;
      s += `<text class="flt-sk-h" x="${SK.x[i]}" y="${SK.top - 10}">${esc(STAGE_LABELS[st])}` +
           ` <tspan class="flt-sk-sub flt-sk-num">${fmt(io[st].in)} in</tspan></text>`;
    });
    // kept node + record fan-out annotation (placed below the S4 drop zone)
    const keptN = io.s4.kept, kh = Math.max(keptN * px, 3);
    s += `<rect x="${SK.x[3]}" y="${SK.top}" width="${SK.nodeW}" height="${kh}" rx="2" fill="${KEPT_COLOR}"></rect>`;
    s += `<text class="flt-sk-h" x="${SK.x[3] - 4}" y="${SK.top - 10}">Kept` +
         ` <tspan class="flt-sk-sub flt-sk-num">${fmt(keptN)} repos</tspan></text>`;
    const s5f = state.index.funnel.s5 || {}, tr = s5f.tracks || {};
    const yAnn = SK.top + io.s4.in * px + SK.stubGap + (io.s4.in - io.s4.kept) * px + 58;
    s += `<line x1="${SK.x[3] + 5}" y1="${SK.top + kh + 4}" x2="${SK.x[3] + 5}" y2="${yAnn - 14}"` +
         ` stroke="#dedede" stroke-dasharray="3 3"></line>`;
    [`${fmt(s5f.records)} records mined`, `${fmt(s5f.classified)} classified`,
     `${fmt((tr.test_update || {}).tasks)} update + ${fmt((tr.test_generation || {}).tasks)} generation tasks`
    ].forEach((t, i) => {
      s += `<text class="flt-sk-sub flt-sk-num" x="${SK.x[3] - 66}" y="${yAnn + i * 16}">↳ ${esc(t)}</text>`;
    });
    // kept ribbons
    stages.forEach((st, i) => {
      const kept = io[st].kept, h = Math.max(kept * px, 2);
      const key = st + "|__kept__";
      const cls = "flt-sk-ribbon" + (active && active !== key ? " flt-dimmed" : "");
      s += `<path class="${cls}" d="${skPath(SK.x[i] + SK.nodeW, SK.top, h, SK.x[i + 1], SK.top, h)}"` +
           ` fill="${KEPT_COLOR}" fill-opacity="0.5" tabindex="0" role="button"` +
           ` data-tip="${esc(`Kept after ${STAGE_LABELS[st]}: ${fmt(kept)} repos (${Math.round(kept * 100 / io[st].in)}%) — click for the survivors`)}"` +
           ` data-fstage="${st}" data-fcode="__kept__"` +
           ` aria-label="kept after ${esc(STAGE_LABELS[st])}: ${fmt(kept)} repos — click to filter"></path>`;
    });
    // drop bundles: ribbons to a stacked stub, labels for segments tall enough
    stages.forEach((st, i) => {
      const segs = foldEntries(st, stageDropsCombined(st));
      const io_ = io[st], xs = SK.x[i] + SK.stubDX;
      let ySrc = SK.top + io_.kept * px;
      let yDst = SK.top + io_.in * px + SK.stubGap;
      const labels = [];
      for (const g of segs) {
        const h = Math.max(g.n * px, 1.4);
        const key = st + "|" + g.code;
        const dimCls = active && active !== key ? " flt-dimmed" : "";
        const tip = `${g.title}: ${fmt(g.n)} repos (${Math.round(g.n * 100 / io_.in)}%)`;
        const attrs = ` data-tip="${esc(tip)}"${g.expl ? ` data-tipx="${esc(g.expl)}"` : ""}` +
                      ` data-fstage="${st}" data-fcode="${esc(g.code)}"`;
        s += `<path class="flt-sk-ribbon${dimCls}" d="${skPath(SK.x[i] + SK.nodeW, ySrc, h, xs, yDst, h)}"` +
             ` fill="${g.color}" fill-opacity="0.55" tabindex="0" role="button"${attrs}` +
             ` aria-label="${esc(g.title)}: ${fmt(g.n)} repos — click to filter"></path>`;
        s += `<rect class="flt-sk-ribbon${dimCls}" x="${xs}" y="${yDst}" width="9" height="${h}"` +
             ` fill="${g.color}"${attrs}></rect>`;
        if (h >= 11) labels.push({ y: yDst + h / 2, t: g.title, n: g.n });
        ySrc += h; yDst += h + 2;
      }
      for (const L of labels) {
        s += `<text class="flt-sk-sub" x="${xs + 16}" y="${L.y + 3.5}">` +
             `${esc(L.t.length > 24 ? L.t.slice(0, 23) + "…" : L.t)}` +
             ` <tspan class="flt-sk-num">${fmt(L.n)}</tspan></text>`;
      }
      s += `<text class="flt-sk-sub flt-sk-num" x="${xs}" y="${yDst + 16}">${fmt(io_.in - io_.kept)}` +
           ` dropped at ${st.toUpperCase()} · hover segments for detail</text>`;
    });
    s += `</svg>`;
    wrap.innerHTML = s;
  }

  /* ---------- commit-level funnel (static) ---------- */

  function wfRow(label, unit, n, max, loss, green) {
    const w = Math.max(n / max * 100, 0.25);
    let hatch = "";
    if (loss) {
      const lw = loss.n / max * 100;
      const tip = `${loss.label}: ${fmt(loss.n)} ${unit} (${Math.round(loss.n * 100 / (n + loss.n))}%)`;
      hatch = `<div class="flt-wf-hatch" style="left:${w}%;width:${lw}%" data-tip="${esc(tip)}">` +
        (lw > 12 ? `<span class="flt-wf-dl">−${fmt(loss.n)} ${esc(loss.label)}</span>` : "") + `</div>`;
    }
    return `<div class="flt-wf-row"><div class="flt-wf-lab">${esc(label)}<span class="flt-wf-unit">${esc(unit)}</span></div>` +
      `<div class="flt-wf-track"><div class="flt-wf-fill${green ? " flt-wf-green" : ""}" style="width:${w}%"` +
      ` data-tip="${esc(`${label}: ${fmt(n)} ${unit}`)}"></div>${hatch}</div>` +
      `<div class="flt-wf-num">${fmt(n)}</div></div>`;
  }
  const wfConn = t => `<div class="flt-wf-conn"><span>↓ ${esc(t)}</span></div>`;

  function renderCommitFunnel() {
    const d = $("flt-commitfunnel");
    if (!d) return;
    const cf = state.index.commit_funnel;
    if (!cf || cf.window_commits == null) { d.style.display = "none"; return; }
    const tr = (state.index.funnel.s5 || {}).tracks || {};
    const tasks = ((tr.test_update || {}).tasks || 0) + ((tr.test_generation || {}).tasks || 0);
    $("flt-wf-summary").innerHTML = `Commit-level funnel — ` +
      `<span class="flt-wf-mono">${fmt(cf.window_commits)}</span> window commits → ` +
      `<span class="flt-wf-mono">${fmt(cf.diff_pairs)}</span> diff pairs → ` +
      `<span class="flt-wf-mono">${fmt(cf.records)}</span> records`;
    $("flt-wf-stats").textContent =
      `${(cf.diff_pairs / cf.window_commits * 100).toFixed(1)}% of window commits survive to a diff pair · ` +
      `${(cf.records / cf.diff_pairs).toFixed(1)} records per diff pair · ` +
      `${Math.round(cf.classified / cf.records * 100)}% of records classified · ` +
      `${fmt(tasks)} tasks (${fmt((tr.test_update || {}).tasks)} update · ${fmt((tr.test_generation || {}).tasks)} generation). ` +
      `Hatched = discarded at that step; drawn only where the two counts are true complements.`;
    const m1 = cf.window_commits, m2 = cf.records;
    let h = "";
    h += wfRow("Java commits in window", "commits", cf.window_commits, m1, null);
    h += wfRow("Selected for build", "commits", cf.selected, m1, { n: cf.window_commits - cf.selected, label: "not selected" });
    h += wfConn("adjacent-commit pairing");
    h += wfRow("Candidate rev pairs", "pairs", cf.candidate_pairs, m1, null);
    h += wfConn("per-commit builds");
    h += wfRow("Commit builds OK", "builds", cf.builds_ok, m1, { n: cf.builds_failed, label: "builds failed" });
    h += wfConn("pair finalisation");
    h += wfRow("Pairs kept", "pairs", cf.pairs_kept, m1, null);
    h += wfRow("Diff pairs (test changed)", "pairs", cf.diff_pairs, m1, { n: cf.pairs_kept - cf.diff_pairs, label: "no test diff" });
    h += `<div class="flt-wf-break"><span>record fan-out · own scale</span><i></i></div>`;
    h += wfRow("Records mined", "records", cf.records, m2, null);
    h += wfRow("Classified", "records", cf.classified, m2, { n: cf.records - cf.classified, label: "dropped by record filters" });
    h += wfRow("Benchmark tasks", "tasks", tasks, m2, null, true);
    $("flt-wf-body").innerHTML = h;
    try {
      if (localStorage.getItem("flt_wf_open") === "1") d.open = true;
      d.addEventListener("toggle", () => { try { localStorage.setItem("flt_wf_open", d.open ? "1" : "0"); } catch (e) {} });
    } catch (e) {}
  }

  /* ---------- active-filter chips ---------- */

  function renderChips() {
    const el = $("flt-chips");
    if (!el) return;
    const chips = [];
    if (state.stage !== "all") chips.push({ f: "stage", text: STAGE_LABELS[state.stage] || state.stage });
    if (state.status !== "all") {
      const text = state.status === "survived"
        ? (state.stage !== "all" ? `survived ${state.stage.toUpperCase()}` : "survived (kept)")
        : (STATUS_LABEL[state.status] || state.status);
      chips.push({ f: "status", text, dot: state.status === "dropped" ? null : KEPT_COLOR });
    }
    if (state.reason !== "all") {
      let st, code;
      if (s5mode()) { st = "s5"; code = state.reason; }
      else { const parts = reasonParts(state.reason); st = parts[0]; code = parts[1]; }
      chips.push({ f: "reason", text: (st ? st.toUpperCase() + " · " : "") + reasonLabel(code),
                   dot: code === "__other__" ? OTHER_COLOR : segColor(st || state.stage, code) });
    }
    if (state.search) chips.push({ f: "search", text: `“${state.search}”` });
    el.innerHTML = chips.map(c =>
      `<span class="flt-chip">` +
      (c.dot ? `<span class="flt-chip-dot" style="background:${c.dot}"></span>` : "") +
      `${esc(c.text)}<button type="button" class="flt-chip-x" data-clear="${c.f}"` +
      ` aria-label="clear ${c.f} filter">✕</button></span>`).join("") +
      (chips.length > 1 ? `<button type="button" class="flt-chip-clearall" data-clear="all">clear all</button>` : "");
  }

  /* ---------- wiring ---------- */

  function setStage(stage) {
    const wasS5 = s5mode();
    state.stage = stage;
    $("flt-stage").value = stage;
    if (s5mode() !== wasS5) {           // mode switch: reset reason + sensible sort
      state.reason = "all";
      state.sortKey = "rec";
      state.sortDir = "desc";
    }
    renderAll();
  }

  function syncControls() {
    $("flt-stage").value = state.stage;
    $("flt-status").value = state.status;
  }

  function renderAll() {
    renderTiles();
    renderSankey();
    renderFunnelBar();
    renderReasonOptions();
    renderChips();
    syncControls();
    renderTable();
  }

  let tipEl = null;
  function ensureTip() {
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.className = "flt-tip";
      tipEl.style.display = "none";
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  function wireFunnelTips() {
    for (const id of ["flt-funnel", "flt-sankey", "flt-commitfunnel"]) {
      const wrap = $(id);
      if (!wrap) continue;
      wrap.addEventListener("mousemove", (e) => {
        const seg = e.target.closest("[data-tip]");
        const tip = ensureTip();
        if (!seg || !seg.dataset.tip) { tip.style.display = "none"; return; }
        tip.innerHTML = esc(seg.dataset.tip) +
          (seg.dataset.tipx ? `<div class="flt-tip-x">${esc(seg.dataset.tipx)}</div>` : "");
        tip.style.display = "block";
        tip.style.left = (e.pageX + 12) + "px";
        tip.style.top = (e.pageY + 14) + "px";
      });
      wrap.addEventListener("mouseleave", () => { if (tipEl) tipEl.style.display = "none"; });
    }
  }

  function wireSegClicks() {
    for (const id of ["flt-funnel", "flt-sankey"]) {
      const wrap = $(id);
      if (!wrap) continue;
      wrap.addEventListener("click", (e) => {
        const t = e.target.closest("[data-fstage]");
        if (t) onSegClick(t);
      });
      wrap.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const t = e.target.closest("[data-fstage]");
        if (t) { e.preventDefault(); onSegClick(t); }
      });
    }
    const chips = $("flt-chips");
    if (chips) chips.addEventListener("click", (e) => {
      const b = e.target.closest("[data-clear]");
      if (!b) return;
      const f = b.dataset.clear;
      if (f === "all") { state.search = ""; $("flt-search").value = ""; setFilterTo("all", "all", "all"); return; }
      if (f === "stage") { setStage("all"); return; }
      if (f === "status") state.status = "all";
      if (f === "reason") state.reason = "all";
      if (f === "search") { state.search = ""; $("flt-search").value = ""; }
      renderAll();
    });
  }

  function wire() {
    wireFunnelTips();
    wireSegClicks();
    for (const p of ["A", "C"]) {
      $(`flt-pool-${p}`).addEventListener("change", (e) => {
        if (e.target.checked) state.pools.add(p); else state.pools.delete(p);
        renderAll();
      });
    }
    $("flt-stage").addEventListener("change", e => setStage(e.target.value));
    $("flt-status").addEventListener("change", e => { state.status = e.target.value; renderAll(); });
    $("flt-reason").addEventListener("change", e => {
      state.reason = e.target.value;
      if (s5mode()) {                    // rank by the selected reason's count
        state.sortKey = state.reason === "all" ? "rec" : "rsel";
        state.sortDir = "desc";
      }
      renderAll();
    });
    $("flt-search").addEventListener("input", e => { state.search = e.target.value.trim(); renderChips(); renderTable(); });
    // sort: delegated — the thead is re-rendered per mode
    document.querySelector("#flt-table thead").addEventListener("click", (e) => {
      const th = e.target.closest("th.sortable");
      if (!th) return;
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortKey = key; state.sortDir = key === "name" ? "asc" : "desc"; }
      renderTable();
    });
  }

  async function init() {
    try {
      const res = await fetch(IDX_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.index = await res.json();
      buildColorMap();
      renderSnapshot();
      renderCommitFunnel();
      wire();
      renderAll();
    } catch (e) {
      const el = $("flt-tbody");
      if (el) el.innerHTML =
        `<tr><td colspan="8" class="empty">Pipeline filter data not published yet (${esc(e.message)}).</td></tr>`;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
