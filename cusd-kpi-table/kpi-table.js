/*
 * CUSD KPI Table — in-dashboard runtime (kpi-table.js)
 * ---------------------------------------------------
 * Tableau glue only. Reads ONE source worksheet's SUMMARY data (RLS-respected),
 * hands it to the pure engine in renderers.js, and re-renders when a dashboard
 * filter/parameter changes.
 *
 * Time model: if the author sets a time dimension (e.g. School Year) the sheet
 * is one row per entity per period. Scalar cells show the FOCAL period; sparkline
 * cells trend across periods. An optional in-extension year selector sets the
 * focal period (self-contained — no Tableau parameter). All periods must be left
 * in the data (don't hard-filter the year on that sheet).
 *
 * Summary data only. No underlying-row reads. No data leaves the browser.
 */
(function () {
  "use strict";

  var SETTINGS_KEY = "kpiConfig";
  var MAX_MAIN_ROWS = 20000;    // entity x period stays modest; cap defensively
  var SAMPLE_ROWS = 12;         // rows passed to Configure for live preview

  // Standard CUSD data-handling notice (mirrors the teacher dashboards + the
  // cusd-excel-export extension); written to the export's "About" tab.
  var DATA_HANDLING_NOTICE = [
    "This and all Tableau reports should be treated as highly protected FERPA data. SHRED ALL PRINTOUTS.",
    "Data available in Tableau is not to be utilized for any research project unless it has been approved using the Research Request Process.",
    "This export reflects only the data the signed-in user is authorized to view (row-level security)."
  ];

  var tableEl, statusEl, exportBtn, yearSelect;
  var reloadTimer = null;
  var listenersAttached = false;
  var lastMain = null;          // most recent source-sheet read {fields, rows}
  var focalPeriod = null;       // selected focal period (formatted), null = latest

  /* ---------------- settings ---------------- */
  function getConfig() {
    try { var raw = tableau.extensions.settings.get(SETTINGS_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }

  function setStatus(msg, isError) {
    statusEl.textContent = msg || "";
    statusEl.className = "status" + (isError ? " error" : "");
    statusEl.style.display = msg ? "flex" : "none";
    tableEl.style.display = msg ? "none" : "table";
  }

  // Shown until the author configures it — tells them exactly what to build.
  function showHelp() {
    statusEl.className = "status help";
    statusEl.style.display = "flex";
    tableEl.style.display = "none";
    statusEl.innerHTML = '<div class="help-card">' +
      '<h3>CUSD KPI Table — set me up</h3>' +
      '<p>Dashboard author, three steps:</p>' +
      '<ol>' +
      '<li><b>Build one worksheet:</b> your row dimension (e.g. Student) on <b>Rows</b>; each measure + any comparison calc (e.g. a FIXED district average) on <b>Detail</b>. For trends, also put your time field (e.g. School Year) on <b>Detail</b>.</li>' +
      '<li><b>Add that worksheet to this dashboard</b> — you can shrink it or tuck it away; it just has to be present.</li>' +
      '<li>Open this extension’s menu (the ▾ on its border) → <b>Configure…</b>, pick the worksheet, set <b>“Each row is,”</b> and map your columns to marks.</li>' +
      '</ol>' +
      '<p class="tip">Tip: whatever shows in the worksheet’s <b>View&nbsp;Data → Summary</b> tab is exactly what this table reads.</p>' +
      '</div>';
  }

  /* ---------------- reading viz data ---------------- */
  // Returns { fields:[name...], rows:[ {name:{v,f}} ... ] } for one worksheet.
  async function readSheet(worksheet, maxRows) {
    var reader = await worksheet.getSummaryDataReaderAsync(maxRows, { ignoreSelection: true });
    try {
      var fields = [], rows = [], headerDone = false;
      for (var p = 0; p < reader.pageCount; p++) {
        var page = await reader.getPageAsync(p);
        if (!headerDone) { fields = page.columns.map(function (c) { return c.fieldName; }); headerDone = true; }
        for (var r = 0; r < page.data.length; r++) {
          var src = page.data[r], obj = {};
          for (var c = 0; c < page.columns.length; c++) {
            var dv = src[c]; // data rows are positional, aligned to page.columns
            obj[page.columns[c].fieldName] = { v: dv ? dv.value : null, f: dv ? dv.formattedValue : "" };
          }
          rows.push(obj);
        }
      }
      return { fields: fields, rows: rows };
    } finally { await reader.releaseAsync(); }
  }

  function worksheetByName(name) {
    var ws = tableau.extensions.dashboardContent.dashboard.worksheets;
    for (var i = 0; i < ws.length; i++) { if (ws[i].name === name) return ws[i]; }
    return null;
  }

  /* ---------------- render ---------------- */
  function renderTable(cfg) {
    if (!lastMain) return;
    var c2 = {}; for (var k in cfg) { if (Object.prototype.hasOwnProperty.call(cfg, k)) c2[k] = cfg[k]; }
    c2.focalPeriod = focalPeriod;
    tableEl.className = "kpi" + (cfg.density === "compact" ? " compact" : "");
    tableEl.innerHTML = KPI.renderTableInner(c2, lastMain.rows);
  }

  // Build / refresh the self-contained focal-year dropdown.
  function buildYearSelector(cfg, periods) {
    if (!yearSelect) return;
    if (!periods.length) { focalPeriod = null; yearSelect.style.display = "none"; return; }
    if (!focalPeriod || !periods.some(function (p) { return p.f === focalPeriod; })) {
      focalPeriod = periods[periods.length - 1].f; // default = latest
    }
    var show = cfg && cfg.showYearSelector && cfg.timeField && periods.length > 1;
    yearSelect.style.display = show ? "inline-block" : "none";
    if (!show) return;
    yearSelect.innerHTML = periods.map(function (p) {
      return '<option value="' + KPI.esc(p.f) + '"' + (p.f === focalPeriod ? " selected" : "") + ">" + KPI.esc(p.f) + "</option>";
    }).join("");
    yearSelect.value = focalPeriod;
    yearSelect.onchange = function () { focalPeriod = this.value; renderTable(getConfig()); };
  }

  async function loadAndRender() {
    var cfg = getConfig();
    if (!cfg || !cfg.sourceSheet || !(cfg.columns && cfg.columns.length)) {
      lastMain = null; applyExportUI(cfg); if (yearSelect) yearSelect.style.display = "none";
      showHelp();
      return;
    }
    var mainWs = worksheetByName(cfg.sourceSheet);
    if (!mainWs) {
      lastMain = null; applyExportUI(cfg); if (yearSelect) yearSelect.style.display = "none";
      setStatus("Source worksheet “" + cfg.sourceSheet + "” isn’t on this dashboard. Re-open Configure… to pick another.", true);
      return;
    }
    try {
      lastMain = await readSheet(mainWs, MAX_MAIN_ROWS);
      buildYearSelector(cfg, KPI.computePeriods(cfg, lastMain.rows));
      renderTable(cfg);
      applyExportUI(cfg);
      setStatus("", false);
    } catch (err) {
      console.error("CUSD KPI Table render failed:", err);
      lastMain = null; applyExportUI(cfg); if (yearSelect) yearSelect.style.display = "none";
      setStatus("Could not read the worksheet data: " + (err && err.message ? err.message : "unknown error"), true);
    }
  }

  function scheduleReload() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(loadAndRender, 250); // debounce filter/param storms
  }

  // Follow dashboard filters + parameters so the table always matches the viz.
  async function attachListeners() {
    if (listenersAttached) return;
    listenersAttached = true;
    var dashboard = tableau.extensions.dashboardContent.dashboard;
    dashboard.worksheets.forEach(function (ws) {
      ws.addEventListener(tableau.TableauEventType.FilterChanged, scheduleReload);
    });
    try {
      var params = await dashboard.getParametersAsync();
      params.forEach(function (p) { p.addEventListener(tableau.TableauEventType.ParameterChanged, scheduleReload); });
    } catch (e) { /* parameters are optional */ }
  }

  /* ---------------- export to Excel (built-in) ----------------
     Exports the source worksheet's summary data (all rows, all periods) as .xlsx
     with a FERPA About tab. Summary data only — RLS already applied. The button
     hides itself if disabled in Configure or if SheetJS wasn't vendored. */
  function applyExportUI(cfg) {
    if (!exportBtn) return;
    var ok = cfg && cfg.exportEnabled !== false && cfg.sourceSheet && typeof XLSX !== "undefined";
    exportBtn.style.display = ok ? "inline-flex" : "none";
    exportBtn.disabled = !(lastMain && lastMain.rows.length);
  }
  function exportFilename(cfg) {
    var prefix = (cfg.exportPrefix && cfg.exportPrefix.trim()) || cfg.sourceSheet || "CUSD_KPI";
    var d = new Date();
    var stamp = d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2);
    return prefix.replace(/[^\w\-]+/g, "_") + "_" + stamp + ".xlsx";
  }
  function onExport() {
    var cfg = getConfig();
    if (!cfg || !lastMain || !lastMain.rows.length || typeof XLSX === "undefined") return;
    try {
      var aoa = [lastMain.fields];
      lastMain.rows.forEach(function (r) { aoa.push(lastMain.fields.map(function (f) { return r[f] ? r[f].f : ""; })); });
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Data");
      if (cfg.exportAbout !== false) {
        var about = [["CUSD Research"], [], ["Confidentiality & data handling"]];
        DATA_HANDLING_NOTICE.forEach(function (l) { about.push([l]); });
        about.push([], ["Source worksheet", cfg.sourceSheet], ["Exported", new Date().toLocaleString()]);
        var aws = XLSX.utils.aoa_to_sheet(about); aws["!cols"] = [{ wch: 100 }, { wch: 22 }];
        XLSX.utils.book_append_sheet(wb, aws, "About");
      }
      XLSX.writeFile(wb, exportFilename(cfg)); // builds + downloads in the browser
    } catch (e) { console.error("CUSD KPI Table export failed:", e); }
  }

  /* ---------------- Configure… (author) ---------------- */
  // The dialog can't read dashboard data itself, so the parent gathers a field
  // catalog + small sample for every sheet and passes it in. That powers the
  // dropdowns (no typing field names) AND the live preview.
  async function gatherCatalog() {
    var catalog = {};
    var ws = tableau.extensions.dashboardContent.dashboard.worksheets;
    for (var i = 0; i < ws.length; i++) {
      try {
        var d = await readSheet(ws[i], SAMPLE_ROWS);
        catalog[ws[i].name] = { fields: d.fields, sample: d.rows };
      } catch (e) {
        catalog[ws[i].name] = { fields: [], sample: [] };
      }
    }
    return catalog;
  }

  async function openConfigure() {
    var payload;
    try {
      payload = JSON.stringify({ catalog: await gatherCatalog(), current: getConfig() || {} });
    } catch (e) {
      console.error("Failed to gather catalog:", e);
      payload = JSON.stringify({ catalog: {}, current: getConfig() || {} });
    }
    var url = new URL("./configure.html", window.location.href).href;
    tableau.extensions.ui.displayDialogAsync(url, payload, { width: 780, height: 700 })
      .then(function (closePayload) {
        if (!closePayload || closePayload === "cancel") return;
        var s = tableau.extensions.settings;
        s.set(SETTINGS_KEY, closePayload); // already JSON from the dialog
        return s.saveAsync();
      })
      .then(function () { focalPeriod = null; loadAndRender(); }) // reset focal to latest on reconfigure
      .catch(function (err) {
        if (err && err.errorCode === tableau.ErrorCodes.DialogClosedByUser) return;
        console.error("Configure dialog error:", err);
      });
  }

  /* ---------------- bootstrap ---------------- */
  function boot() {
    tableEl = document.getElementById("kpiTable");
    statusEl = document.getElementById("status");
    exportBtn = document.getElementById("exportBtn");
    yearSelect = document.getElementById("yearSelect");
    if (exportBtn) exportBtn.addEventListener("click", onExport);
    applyExportUI(getConfig());

    tableau.extensions.initializeAsync({ configure: openConfigure })
      .then(function () { return attachListeners(); })
      .then(function () { return loadAndRender(); })
      .catch(function (err) {
        console.error("Failed to initialize CUSD KPI Table:", err);
        setStatus("Could not initialize the extension.", true);
      });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
