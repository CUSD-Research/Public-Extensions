/*
 * CUSD Excel Export — Configure dialog (author-only)
 * --------------------------------------------------
 * Runs inside the pop-up opened from the extension's "Configure…" menu item.
 * It receives the dashboard's worksheet names + current settings as a payload,
 * lets the author pick the allow-list and a few options, and returns the chosen
 * config to the parent (excel-export.js) which performs the actual save.
 *
 * This page is pure UI — it never reads or writes settings itself, so there is
 * one and only one place that persists config (the parent).
 */
(function () {
  "use strict";

  var saveBtn = document.getElementById("saveBtn");
  var cancelBtn = document.getElementById("cancelBtn");
  var sheetListEl = document.getElementById("sheetList");
  var prefixEl = document.getElementById("prefix");
  var filenameParamEl = document.getElementById("filenameParam");
  var footerToggleEl = document.getElementById("footerToggle");
  var footerTextEl = document.getElementById("footerText");
  var buttonLabelEl = document.getElementById("buttonLabel");

  // Per-sheet column names in view order, as handed over by the parent
  // (excel-export.js has the live worksheet API; this dialog is pure UI).
  // A sheet absent from this map — e.g. its host is below API 1.13 — just
  // gets no column picker and stays "all columns".
  var columnsBySheet = {};

  function renderParameterOptions(parameterNames, current) {
    filenameParamEl.innerHTML = "";
    var noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "(none)";
    filenameParamEl.appendChild(noneOpt);
    (parameterNames || []).forEach(function (name) {
      var opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      filenameParamEl.appendChild(opt);
    });
    filenameParamEl.value = current.filenameParam || "";
    // Selected param no longer exists on this dashboard (e.g. renamed) — fall
    // back to "(none)" rather than silently keeping an unmatched value.
    if (filenameParamEl.value !== (current.filenameParam || "")) {
      filenameParamEl.value = "";
    }
  }

  // Builds the checkbox + nested column-picker for one sheet row.
  function buildSheetRow(name, idx, allowedSheets, sheetColumns) {
    var wrapEl = document.createElement("div");
    wrapEl.className = "sheet-block";

    var rowEl = document.createElement("label");
    rowEl.className = "sheet-row";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = "sheet_" + idx;
    cb.value = name;
    cb.checked = !!allowedSheets[name];
    var span = document.createElement("span");
    span.textContent = name;
    rowEl.appendChild(cb);
    rowEl.appendChild(span);
    wrapEl.appendChild(rowEl);

    var cols = columnsBySheet[name];
    if (cols && cols.length > 1) {
      var selected = {};
      // Default (no stored entry, or an entry naming every column) = all
      // columns checked; only an explicit, incomplete subset unchecks any.
      var stored = sheetColumns[name];
      var subset = Array.isArray(stored) && stored.length && stored.length < cols.length;
      if (subset) { stored.forEach(function (n) { selected[n] = true; }); }

      var colListEl = document.createElement("div");
      colListEl.className = "col-list";
      cols.forEach(function (colName, cidx) {
        var colRowEl = document.createElement("label");
        colRowEl.className = "col-row";
        var colCb = document.createElement("input");
        colCb.type = "checkbox";
        colCb.className = "col-checkbox";
        colCb.dataset.sheet = name;
        colCb.id = "sheet_" + idx + "_col_" + cidx;
        colCb.value = colName;
        colCb.checked = subset ? !!selected[colName] : true;
        var colSpan = document.createElement("span");
        colSpan.textContent = colName;
        colRowEl.appendChild(colCb);
        colRowEl.appendChild(colSpan);
        colListEl.appendChild(colRowEl);
      });
      wrapEl.appendChild(colListEl);
    }

    return wrapEl;
  }

  function render(sheetNames, current) {
    // Build one checkbox (+ optional column picker) per worksheet.
    if (!sheetNames.length) {
      sheetListEl.innerHTML = '<span class="empty">This dashboard has no worksheets.</span>';
    } else {
      var allowed = {};
      (current.allowedSheets || []).forEach(function (n) { allowed[n] = true; });
      var sheetColumns = current.sheetColumns || {};
      sheetListEl.innerHTML = "";
      sheetNames.forEach(function (name, idx) {
        sheetListEl.appendChild(buildSheetRow(name, idx, allowed, sheetColumns));
      });
    }

    prefixEl.value = current.filenamePrefix || "CUSD_Export";
    footerToggleEl.checked = current.includeFooter !== false;
    footerTextEl.value = current.footerText || "";
    buttonLabelEl.value = current.buttonLabel || "Download to Excel";
  }

  function collectAllowedSheets() {
    var checked = sheetListEl.querySelectorAll('.sheet-row > input[type="checkbox"]:checked');
    return Array.prototype.map.call(checked, function (cb) { return cb.value; });
  }

  // Only records a sheet's entry when the author unchecked at least one
  // column — "all checked" is the default and stays represented as "no
  // entry" so a sheet with columns added later isn't silently truncated.
  function collectSheetColumns() {
    var result = {};
    Object.keys(columnsBySheet).forEach(function (name) {
      var boxes = sheetListEl.querySelectorAll('.col-checkbox[data-sheet="' + CSS.escape(name) + '"]');
      if (!boxes.length) { return; }
      var checked = Array.prototype.filter.call(boxes, function (cb) { return cb.checked; });
      if (checked.length && checked.length < boxes.length) {
        result[name] = checked.map(function (cb) { return cb.value; });
      }
    });
    return result;
  }

  function onSave() {
    var cfg = {
      allowedSheets: collectAllowedSheets(),
      sheetColumns: collectSheetColumns(),
      filenamePrefix: (prefixEl.value || "CUSD_Export").trim(),
      filenameParam: filenameParamEl.value || "",
      includeFooter: footerToggleEl.checked,
      footerText: footerTextEl.value.trim(),
      buttonLabel: (buttonLabelEl.value || "Download to Excel").trim()
    };
    tableau.extensions.ui.closeDialog(JSON.stringify(cfg));
  }

  function onCancel() {
    // Sentinel the parent recognises as "leave settings untouched".
    tableau.extensions.ui.closeDialog("cancel");
  }

  tableau.extensions.initializeDialogAsync()
    .then(function (openPayload) {
      var data = {};
      try { data = JSON.parse(openPayload) || {}; } catch (e) { data = {}; }
      columnsBySheet = data.columnsBySheet || {};
      render(data.sheetNames || [], data.current || {});
      renderParameterOptions(data.parameterNames || [], data.current || {});
      saveBtn.addEventListener("click", onSave);
      cancelBtn.addEventListener("click", onCancel);
    })
    .catch(function (err) {
      console.error("Configure dialog failed to initialize:", err);
      sheetListEl.innerHTML = '<span class="empty">Could not load worksheets.</span>';
    });
})();
