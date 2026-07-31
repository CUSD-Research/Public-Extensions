/*
 * CUSD Excel Export — in-dashboard logic
 * --------------------------------------
 * A Tableau Dashboard Extension that adds a one-click "Download to Excel" button.
 * The dashboard author decides (via the Configure… dialog) WHICH worksheets the
 * button is allowed to export. End users click once and get an .xlsx — no
 * sheet-selection dialog.
 *
 * Guardrails baked in for CUSD:
 *   1. Allow-list only. The button exports ONLY worksheets the author explicitly
 *      enabled. A hidden/underlying sheet that was never enabled cannot be dumped.
 *   2. Summary data only. We read getSummaryDataReaderAsync (the aggregated data
 *      shown on screen), never the row-level underlying data. RLS is respected
 *      automatically because we read what the signed-in user already sees.
 *   3. Optional confidentiality "About" tab + a CUSD-convention file name.
 *
 * No district data leaves the browser: data is read from the rendered viz and
 * written straight into a local file with SheetJS.
 */
(function () {
  "use strict";

  // Settings keys (stored per-extension-instance via tableau.extensions.settings).
  var KEYS = {
    allowedSheets: "allowedSheets",   // JSON array of worksheet names
    filenamePrefix: "filenamePrefix", // string
    filenameParam: "filenameParam",   // string — parameter name, "" = disabled
    sheetColumns: "sheetColumns",     // JSON {sheetName: [fieldName,...]} — subset only, absent = all
    includeFooter: "includeFooter",   // "true" / "false"
    footerText: "footerText",         // string
    buttonLabel: "buttonLabel"        // string
  };

  var DEFAULT_FOOTER = "CUSD Research";

  // Standard CUSD data-handling notice (mirrors the warning on the teacher
  // dashboards); shown on the optional "About" tab.
  var DATA_HANDLING_NOTICE = [
    "This and all Tableau reports should be treated as highly protected FERPA data. SHRED ALL PRINTOUTS.",
    "Data available in Tableau is not to be utilized for any research project unless it has been approved using the Research Request Process.",
    "This export reflects only the data the signed-in user is authorized to view (row-level security)."
  ];

  var btn = document.getElementById("downloadBtn");
  var statusEl = document.getElementById("status");

  // Transient only: any message clears itself so nothing lingers over the icon.
  var statusTimer = null;
  function setStatus(msg, isError) {
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("error", !!isError);
    if (msg) {
      statusTimer = setTimeout(function () {
        statusEl.textContent = "";
        statusEl.classList.remove("error");
      }, isError ? 6000 : 2000);
    }
  }

  // --- settings helpers -----------------------------------------------------
  function getSetting(key, fallback) {
    var v = tableau.extensions.settings.get(key);
    return (v === undefined || v === null) ? fallback : v;
  }

  function getAllowedSheets() {
    try {
      var raw = tableau.extensions.settings.get(KEYS.allowedSheets);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  // {sheetName: [fieldName,...]} — a sheet with no entry exports all its columns.
  function getSheetColumnsMap() {
    try {
      var raw = tableau.extensions.settings.get(KEYS.sheetColumns);
      var obj = raw ? JSON.parse(raw) : {};
      return (obj && typeof obj === "object" && !Array.isArray(obj)) ? obj : {};
    } catch (e) {
      return {};
    }
  }

  // The button is icon-only (the Excel glyph), so the label is exposed as the
  // tooltip / accessible name — setting textContent here would wipe the SVG.
  function applyButtonLabel() {
    var label = getSetting(KEYS.buttonLabel, "Download to Excel");
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }

  // Reflect current config in the idle status line so the author gets feedback.
  // Icon-only with no resting label: keep the area below the button empty and
  // just enable/disable it. Transient progress and errors still use setStatus.
  function refreshIdleStatus() {
    btn.disabled = !getAllowedSheets().length;
    setStatus("");
  }

  // --- Excel sheet-name sanitising -----------------------------------------
  // Excel tab names: max 31 chars, none of  : \ / ? * [ ]  , must be unique.
  function safeSheetName(name, used) {
    var clean = String(name).replace(/[:\\\/?*\[\]]/g, " ").trim().slice(0, 31) || "Sheet";
    var candidate = clean, i = 2;
    while (used[candidate.toLowerCase()]) {
      var suffix = " (" + i + ")";
      candidate = clean.slice(0, 31 - suffix.length) + suffix;
      i++;
    }
    used[candidate.toLowerCase()] = true;
    return candidate;
  }

  // Map the summary reader's columns onto the sheet's on-screen field order.
  //
  // Why this is needed: getSummaryDataReaderAsync returns its pages with the
  // columns sorted ALPHABETICALLY, which does not match the order the fields sit
  // in on the worksheet. getSummaryColumnsInfoAsync (Extensions API 1.13+)
  // returns the SAME columns in view order, so we use it to derive a permutation.
  //
  // `readerCols` is one page's `columns` (alphabetical); `viewCols` is the view
  // order from getSummaryColumnsInfoAsync. Returns an array of reader-column
  // indices in view order. If the view order is unavailable (older host) or can't
  // be matched 1:1, it returns the reader's own order so nothing breaks — the
  // export just falls back to the previous alphabetical behaviour.
  function buildColumnOrder(readerCols, viewCols) {
    var identity = readerCols.map(function (_, i) { return i; });
    if (!viewCols || !viewCols.length) { return identity; }

    // Prefer fieldId (stable, unique); fall back to fieldName.
    var byId = {}, byName = {};
    readerCols.forEach(function (c, i) {
      if (c.fieldId != null) { byId[c.fieldId] = i; }
      if (byName[c.fieldName] === undefined) { byName[c.fieldName] = i; }
    });

    var order = [], seen = {};
    viewCols.forEach(function (vc) {
      var idx = (vc.fieldId != null && byId[vc.fieldId] !== undefined) ? byId[vc.fieldId]
              : (byName[vc.fieldName] !== undefined ? byName[vc.fieldName] : -1);
      if (idx === -1 || seen[idx]) { return; }
      seen[idx] = true;
      order.push(idx);
    });
    // Append any reader column the view order didn't mention, so no column is
    // ever silently dropped.
    for (var i = 0; i < readerCols.length; i++) {
      if (!seen[i]) { order.push(i); }
    }
    // Only trust the reordering if it's a clean permutation of every column.
    return order.length === readerCols.length ? order : identity;
  }

  // Read every page of one worksheet's summary data into an array-of-arrays
  // (first row = column headers), with columns in the sheet's on-screen order.
  // `allowedCols`, if given, is a field-name allow-list (author's per-sheet
  // column picker in Configure) — a falsy/empty value exports every column.
  async function readSheetAsAoa(worksheet, allowedCols) {
    // View-order columns; the reader itself hands columns back alphabetically.
    // Feature-detected + wrapped so an older host (< API 1.13) or an API error
    // just falls through to the reader's order rather than failing the export.
    var viewCols = null;
    if (typeof worksheet.getSummaryColumnsInfoAsync === "function") {
      try {
        viewCols = await worksheet.getSummaryColumnsInfoAsync();
      } catch (e) {
        viewCols = null;
      }
    }

    var reader = await worksheet.getSummaryDataReaderAsync(10000, { ignoreSelection: true });
    try {
      var aoa = [];
      var order = null; // reader-column indices, in view order (set on first page)
      for (var p = 0; p < reader.pageCount; p++) {
        var page = await reader.getPageAsync(p);
        if (order === null) {
          order = buildColumnOrder(page.columns, viewCols);
          if (allowedCols && allowedCols.length) {
            var allowSet = {};
            allowedCols.forEach(function (n) { allowSet[n] = true; });
            var filtered = order.filter(function (ci) { return allowSet[page.columns[ci].fieldName]; });
            // Only trust the filter if it actually matched something — an
            // author's stale column name (field renamed) shouldn't zero out the sheet.
            if (filtered.length) { order = filtered; }
          }
          aoa.push(order.map(function (ci) { return page.columns[ci].fieldName; }));
        }
        for (var r = 0; r < page.data.length; r++) {
          var row = page.data[r];
          aoa.push(order.map(function (ci) { return row[ci].formattedValue; }));
        }
      }
      return aoa;
    } finally {
      await reader.releaseAsync(); // free the reader even if a page errors
    }
  }

  // Optionally folds a parameter's current value into the filename (e.g. a
  // "Selected School" parameter) between the prefix and the date stamp.
  async function buildFilename() {
    var parts = [getSetting(KEYS.filenamePrefix, "CUSD_Export").replace(/[^\w\-]+/g, "_")];

    var paramName = getSetting(KEYS.filenameParam, "");
    if (paramName) {
      try {
        var params = await tableau.extensions.dashboardContent.dashboard.getParametersAsync();
        var param = params.filter(function (p) { return p.name === paramName; })[0];
        var raw = param && param.currentValue ? param.currentValue.formattedValue : null;
        var clean = raw ? String(raw).replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) : "";
        if (clean) { parts.push(clean); }
      } catch (e) {
        // Parameter renamed/removed since Configure — fall through without it.
      }
    }

    var d = new Date();
    parts.push(d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2));
    return parts.join("_") + ".xlsx";
  }

  // --- main click handler ---------------------------------------------------
  async function onDownloadClick() {
    var allowed = getAllowedSheets();
    if (!allowed.length) {
      setStatus("Nothing to export — configure the allowed sheets first.", true);
      return;
    }

    btn.disabled = true;   // dim the icon while it works; no text overlay

    try {
      var dashboard = tableau.extensions.dashboardContent.dashboard;
      var byName = {};
      dashboard.worksheets.forEach(function (w) { byName[w.name] = w; });

      var wb = XLSX.utils.book_new();
      var usedNames = {};
      var exported = 0;
      var sheetColsMap = getSheetColumnsMap();

      for (var i = 0; i < allowed.length; i++) {
        var name = allowed[i];
        var ws = byName[name];
        if (!ws) { continue; } // author enabled a sheet that no longer exists — skip quietly
        var aoa = await readSheetAsAoa(ws, sheetColsMap[name]);
        var sheet = XLSX.utils.aoa_to_sheet(aoa);
        XLSX.utils.book_append_sheet(wb, sheet, safeSheetName(name, usedNames));
        exported++;
      }

      if (!exported) {
        setStatus("None of the configured sheets are on this dashboard right now.", true);
        btn.disabled = false;
        return;
      }

      // Optional confidentiality / provenance tab.
      if (getSetting(KEYS.includeFooter, "true") === "true") {
        var footer = getSetting(KEYS.footerText, DEFAULT_FOOTER);
        var aboutRows = [
          [footer],
          [],
          ["Confidentiality & data handling"]
        ];
        DATA_HANDLING_NOTICE.forEach(function (line) { aboutRows.push([line]); });
        aboutRows.push(
          [],
          ["Source dashboard", dashboard.name],
          ["Exported", new Date().toLocaleString()]
        );
        var about = XLSX.utils.aoa_to_sheet(aboutRows);
        about["!cols"] = [{ wch: 100 }, { wch: 22 }];   // widen col A so the notice text is readable
        XLSX.utils.book_append_sheet(wb, about, safeSheetName("About", usedNames));
      }

      XLSX.writeFile(wb, await buildFilename()); // triggers the browser download
      setStatus("");                       // the download itself is the feedback
    } catch (err) {
      console.error("CUSD Excel Export failed:", err);
      setStatus("Export failed: " + (err && err.message ? err.message : "unknown error"), true);
    } finally {
      btn.disabled = false;
    }
  }

  // --- Configure… dialog launch (author-only) -------------------------------
  // Registered via the `configure` callback below; Tableau wires it to the
  // "Configure…" context-menu item declared in the .trex manifest.
  async function openConfigure() {
    var dashboard = tableau.extensions.dashboardContent.dashboard;

    // Per-sheet column names in view order — best-effort. A sheet whose host
    // lacks getSummaryColumnsInfoAsync (< API 1.13) or errors is just left out
    // of the map, so the dialog shows no column picker for it (stays "all
    // columns") instead of forcing a live data read to populate one.
    var columnsBySheet = {};
    for (var i = 0; i < dashboard.worksheets.length; i++) {
      var w = dashboard.worksheets[i];
      if (typeof w.getSummaryColumnsInfoAsync !== "function") { continue; }
      try {
        var cols = await w.getSummaryColumnsInfoAsync();
        columnsBySheet[w.name] = cols.map(function (c) { return c.fieldName; });
      } catch (e) { /* leave unset */ }
    }

    var parameterNames = [];
    try {
      var params = await dashboard.getParametersAsync();
      parameterNames = params.map(function (p) { return p.name; });
    } catch (e) { /* leave empty — dialog just shows "(none)" */ }

    var payload = JSON.stringify({
      sheetNames: dashboard.worksheets.map(function (w) { return w.name; }),
      columnsBySheet: columnsBySheet,
      parameterNames: parameterNames,
      current: {
        allowedSheets: getAllowedSheets(),
        sheetColumns: getSheetColumnsMap(),
        filenamePrefix: getSetting(KEYS.filenamePrefix, "CUSD_Export"),
        filenameParam: getSetting(KEYS.filenameParam, ""),
        includeFooter: getSetting(KEYS.includeFooter, "true") === "true",
        footerText: getSetting(KEYS.footerText, DEFAULT_FOOTER),
        buttonLabel: getSetting(KEYS.buttonLabel, "Download to Excel")
      }
    });
    var url = new URL("./configure.html", window.location.href).href;

    tableau.extensions.ui.displayDialogAsync(url, payload, { height: 620, width: 520 })
      .then(function (closePayload) {
        // The dialog returns the chosen config as JSON; the parent saves it.
        // "cancel" (or an empty payload) means the author backed out — leave settings as-is.
        if (!closePayload || closePayload === "cancel") { return; }
        var cfg = JSON.parse(closePayload);
        var s = tableau.extensions.settings;
        s.set(KEYS.allowedSheets, JSON.stringify(cfg.allowedSheets || []));
        s.set(KEYS.sheetColumns, JSON.stringify(cfg.sheetColumns || {}));
        s.set(KEYS.filenamePrefix, cfg.filenamePrefix || "CUSD_Export");
        s.set(KEYS.filenameParam, cfg.filenameParam || "");
        s.set(KEYS.includeFooter, cfg.includeFooter ? "true" : "false");
        s.set(KEYS.footerText, cfg.footerText || DEFAULT_FOOTER);
        s.set(KEYS.buttonLabel, cfg.buttonLabel || "Download to Excel");
        return s.saveAsync();
      })
      .then(function () {
        applyButtonLabel();
        refreshIdleStatus();
      })
      .catch(function (err) {
        // DialogClosedByUser just means the author hit Cancel / closed it — not an error.
        if (err && err.errorCode === tableau.ErrorCodes.DialogClosedByUser) { return; }
        console.error("Configure dialog error:", err);
      });
  }

  // --- bootstrap ------------------------------------------------------------
  tableau.extensions.initializeAsync({ configure: openConfigure })
    .then(function () {
      applyButtonLabel();
      refreshIdleStatus();
      btn.addEventListener("click", onDownloadClick);
    })
    .catch(function (err) {
      console.error("Failed to initialize CUSD Excel Export:", err);
      setStatus("Could not initialize the extension.", true);
    });
})();
