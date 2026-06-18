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
  var footerToggleEl = document.getElementById("footerToggle");
  var footerTextEl = document.getElementById("footerText");
  var buttonLabelEl = document.getElementById("buttonLabel");

  function render(sheetNames, current) {
    // Build one checkbox per worksheet on the dashboard.
    if (!sheetNames.length) {
      sheetListEl.innerHTML = '<span class="empty">This dashboard has no worksheets.</span>';
    } else {
      var allowed = {};
      (current.allowedSheets || []).forEach(function (n) { allowed[n] = true; });
      sheetListEl.innerHTML = "";
      sheetNames.forEach(function (name, idx) {
        var id = "sheet_" + idx;
        var rowEl = document.createElement("label");
        rowEl.className = "sheet-row";
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.id = id;
        cb.value = name;
        cb.checked = !!allowed[name];
        var span = document.createElement("span");
        span.textContent = name;
        rowEl.appendChild(cb);
        rowEl.appendChild(span);
        sheetListEl.appendChild(rowEl);
      });
    }

    prefixEl.value = current.filenamePrefix || "CUSD_Export";
    footerToggleEl.checked = current.includeFooter !== false;
    footerTextEl.value = current.footerText || "";
    buttonLabelEl.value = current.buttonLabel || "Download to Excel";
  }

  function collectAllowedSheets() {
    var checked = sheetListEl.querySelectorAll('input[type="checkbox"]:checked');
    return Array.prototype.map.call(checked, function (cb) { return cb.value; });
  }

  function onSave() {
    var cfg = {
      allowedSheets: collectAllowedSheets(),
      filenamePrefix: (prefixEl.value || "CUSD_Export").trim(),
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
      render(data.sheetNames || [], data.current || {});
      saveBtn.addEventListener("click", onSave);
      cancelBtn.addEventListener("click", onCancel);
    })
    .catch(function (err) {
      console.error("Configure dialog failed to initialize:", err);
      sheetListEl.innerHTML = '<span class="empty">Could not load worksheets.</span>';
    });
})();
