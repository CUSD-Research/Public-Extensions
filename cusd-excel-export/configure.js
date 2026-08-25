/*
 * CUSD Excel Export — Configure dialog (author-only)
 * --------------------------------------------------
 * Runs inside the pop-up opened from the extension's "Configure…" menu item.
 * It receives the dashboard's worksheets (name, columns, suggested exclusions)
 * plus the current settings as a payload, lets the author pick the allow-list,
 * the columns each sheet exports and the layout, and returns the chosen config
 * to the parent (excel-export.js) which performs the actual save.
 *
 * This page is pure UI — it never reads or writes settings itself, so there is
 * one and only one place that persists config (the parent).
 *
 * Why the layout has to be declared here rather than detected: the Extensions
 * API exposes the marks card (Color / Text / Tooltip …) but NOT which fields sit
 * on the Rows shelf versus the Columns shelf. So an author who wants the file to
 * look like the crosstab on screen names the across-the-top field(s) once.
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

  // sheetName -> { allowed, columns, exclude:{name:true}, across:{name:true}, value }
  var state = {};
  var order = [];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
  }

  function includedColumns(st) {
    return st.columns.filter(function (c) { return !st.exclude[c]; });
  }

  // --- one sheet's panel ----------------------------------------------------
  function renderPanel(st, panel) {
    panel.innerHTML = "";
    if (!st.allowed) { return; }

    if (!st.columns.length) {
      panel.appendChild(el("p", "help",
        "Column details are not available from this Tableau version — every column on the sheet will be exported."));
      return;
    }

    // Columns to include.
    var colsBlock = el("div", "sub-block");
    colsBlock.appendChild(el("div", "sub-title", "Columns to include"));
    colsBlock.appendChild(el("p", "help",
      "Unticked columns are left out of the download. Tooltip-only fields and sort helpers start unticked."));

    var colList = el("div", "col-list");
    st.columns.forEach(function (name) {
      var row = el("label", "col-row");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !st.exclude[name];
      cb.addEventListener("change", function () {
        if (cb.checked) { delete st.exclude[name]; }
        else {
          st.exclude[name] = true;
          delete st.across[name];
          if (st.value === name) { st.value = ""; }
        }
        renderPanel(st, panel);
      });
      row.appendChild(cb);
      row.appendChild(el("span", null, name));
      colList.appendChild(row);
    });
    colsBlock.appendChild(colList);
    panel.appendChild(colsBlock);

    // Layout.
    var layoutBlock = el("div", "sub-block");
    layoutBlock.appendChild(el("div", "sub-title", "Layout"));

    [
      { key: "flat", label: "Flat table — one row per mark, one column per field" },
      { key: "cross", label: "Match the worksheet — crosstab, values across the top" }
    ].forEach(function (opt) {
      var row = el("label", "col-row");
      var radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "layout_" + st.name;
      radio.checked = (opt.key === "cross") === !!st.pendingCrosstab;
      radio.addEventListener("change", function () {
        st.pendingCrosstab = opt.key === "cross";
        if (!st.pendingCrosstab) { st.across = {}; st.value = ""; }
        renderPanel(st, panel);
      });
      row.appendChild(radio);
      row.appendChild(el("span", null, opt.label));
      layoutBlock.appendChild(row);
    });

    if (st.pendingCrosstab) {
      var included = includedColumns(st);

      layoutBlock.appendChild(el("div", "sub-title", "Across the top"));
      layoutBlock.appendChild(el("p", "help",
        "One header row per field, in this order. Everything else you kept becomes a row header."));
      included.forEach(function (name) {
        if (name === st.value) { return; }
        var row = el("label", "col-row");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!st.across[name];
        cb.addEventListener("change", function () {
          if (cb.checked) { st.across[name] = true; } else { delete st.across[name]; }
          renderPanel(st, panel);
        });
        row.appendChild(cb);
        row.appendChild(el("span", null, name));
        layoutBlock.appendChild(row);
      });

      layoutBlock.appendChild(el("div", "sub-title", "Values in the cells"));
      var select = document.createElement("select");
      var blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "— choose a field —";
      select.appendChild(blank);
      included.forEach(function (name) {
        if (st.across[name]) { return; }
        var opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        opt.selected = st.value === name;
        select.appendChild(opt);
      });
      select.addEventListener("change", function () {
        st.value = select.value;
        renderPanel(st, panel);
      });
      layoutBlock.appendChild(select);

      if (!Object.keys(st.across).length || !st.value) {
        layoutBlock.appendChild(el("p", "help warn",
          "Pick at least one across-the-top field and a value field — until then this sheet exports as a flat table."));
      }
    }

    panel.appendChild(layoutBlock);
  }

  // --- whole dialog ---------------------------------------------------------
  function render(sheets, current) {
    var allowed = {};
    (current.allowedSheets || []).forEach(function (n) { allowed[n] = true; });
    var saved = current.sheetConfig || {};

    state = {};
    order = [];
    sheets.forEach(function (s) {
      var prior = saved[s.name];
      var exclude = {};
      // No saved config for this sheet yet (a fresh dashboard, or one set up
      // before per-column choices existed): start from the suggestions.
      (prior && Array.isArray(prior.exclude) ? prior.exclude : (s.suggestExclude || []))
        .forEach(function (n) { exclude[n] = true; });
      var across = {};
      ((prior && prior.across) || []).forEach(function (n) { across[n] = true; });
      state[s.name] = {
        name: s.name,
        allowed: !!allowed[s.name],
        columns: s.columns || [],
        exclude: exclude,
        across: across,
        value: (prior && prior.value) || "",
        pendingCrosstab: Object.keys(across).length > 0
      };
      order.push(s.name);
    });

    if (!sheets.length) {
      sheetListEl.innerHTML = '<span class="empty">This dashboard has no worksheets.</span>';
    } else {
      sheetListEl.innerHTML = "";
      order.forEach(function (name) {
        var st = state[name];
        var wrap = el("div", "sheet-block");
        var head = el("label", "sheet-row");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = st.allowed;
        var panel = el("div", "sheet-panel");
        cb.addEventListener("change", function () {
          st.allowed = cb.checked;
          renderPanel(st, panel);
        });
        head.appendChild(cb);
        head.appendChild(el("span", null, name));
        wrap.appendChild(head);
        wrap.appendChild(panel);
        sheetListEl.appendChild(wrap);
        renderPanel(st, panel);
      });
    }

    prefixEl.value = current.filenamePrefix || "CUSD_Export";
    footerToggleEl.checked = current.includeFooter !== false;
    footerTextEl.value = current.footerText || "";
    buttonLabelEl.value = current.buttonLabel || "Download to Excel";
  }

  function onSave() {
    var allowedSheets = [], sheetConfig = {};
    order.forEach(function (name) {
      var st = state[name];
      if (!st.allowed) { return; }
      allowedSheets.push(name);
      // Keep the author's column order for the across-the-top stack, so the
      // header rows read the way the shelf does.
      var across = st.columns.filter(function (c) { return st.across[c] && !st.exclude[c]; });
      sheetConfig[name] = {
        exclude: Object.keys(st.exclude),
        across: (st.value && across.length) ? across : [],
        value: (st.value && across.length) ? st.value : ""
      };
    });

    var cfg = {
      allowedSheets: allowedSheets,
      sheetConfig: sheetConfig,
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
      render(data.sheets || [], data.current || {});
      saveBtn.addEventListener("click", onSave);
      cancelBtn.addEventListener("click", onCancel);
    })
    .catch(function (err) {
      console.error("Configure dialog failed to initialize:", err);
      sheetListEl.innerHTML = '<span class="empty">Could not load worksheets.</span>';
    });
})();
