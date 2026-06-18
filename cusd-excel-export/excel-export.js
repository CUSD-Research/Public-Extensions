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
    includeFooter: "includeFooter",   // "true" / "false"
    footerText: "footerText",         // string
    buttonLabel: "buttonLabel"        // string
  };

  var DEFAULT_FOOTER =
    "CUSD Research & Data Analytics — Confidential. " +
    "Reflects only data the signed-in user is authorized to view (row-level security).";

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

  // Read every page of one worksheet's summary data into an array-of-arrays
  // (first row = column headers).
  async function readSheetAsAoa(worksheet) {
    var reader = await worksheet.getSummaryDataReaderAsync(10000, { ignoreSelection: true });
    try {
      var aoa = [];
      var headerWritten = false;
      for (var p = 0; p < reader.pageCount; p++) {
        var page = await reader.getPageAsync(p);
        if (!headerWritten) {
          aoa.push(page.columns.map(function (c) { return c.fieldName; }));
          headerWritten = true;
        }
        for (var r = 0; r < page.data.length; r++) {
          var row = page.data[r];
          aoa.push(row.map(function (cell) { return cell.formattedValue; }));
        }
      }
      return aoa;
    } finally {
      await reader.releaseAsync(); // free the reader even if a page errors
    }
  }

  function buildFilename() {
    var prefix = getSetting(KEYS.filenamePrefix, "CUSD_Export");
    var d = new Date();
    var stamp = d.getFullYear() +
      ("0" + (d.getMonth() + 1)).slice(-2) +
      ("0" + d.getDate()).slice(-2);
    return prefix.replace(/[^\w\-]+/g, "_") + "_" + stamp + ".xlsx";
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

      for (var i = 0; i < allowed.length; i++) {
        var name = allowed[i];
        var ws = byName[name];
        if (!ws) { continue; } // author enabled a sheet that no longer exists — skip quietly
        var aoa = await readSheetAsAoa(ws);
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
        var about = XLSX.utils.aoa_to_sheet([
          ["CUSD Research & Data Analytics"],
          [footer],
          [],
          ["Source dashboard", dashboard.name],
          ["Exported", new Date().toLocaleString()]
        ]);
        XLSX.utils.book_append_sheet(wb, about, safeSheetName("About this export", usedNames));
      }

      XLSX.writeFile(wb, buildFilename()); // triggers the browser download
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
  function openConfigure() {
    var dashboard = tableau.extensions.dashboardContent.dashboard;
    var payload = JSON.stringify({
      sheetNames: dashboard.worksheets.map(function (w) { return w.name; }),
      current: {
        allowedSheets: getAllowedSheets(),
        filenamePrefix: getSetting(KEYS.filenamePrefix, "CUSD_Export"),
        includeFooter: getSetting(KEYS.includeFooter, "true") === "true",
        footerText: getSetting(KEYS.footerText, DEFAULT_FOOTER),
        buttonLabel: getSetting(KEYS.buttonLabel, "Download to Excel")
      }
    });
    var url = new URL("./configure.html", window.location.href).href;

    tableau.extensions.ui.displayDialogAsync(url, payload, { height: 520, width: 500 })
      .then(function (closePayload) {
        // The dialog returns the chosen config as JSON; the parent saves it.
        // "cancel" (or an empty payload) means the author backed out — leave settings as-is.
        if (!closePayload || closePayload === "cancel") { return; }
        var cfg = JSON.parse(closePayload);
        var s = tableau.extensions.settings;
        s.set(KEYS.allowedSheets, JSON.stringify(cfg.allowedSheets || []));
        s.set(KEYS.filenamePrefix, cfg.filenamePrefix || "CUSD_Export");
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
