/*
 * CUSD Excel Export — Configure dialog (author-only)
 * --------------------------------------------------
 * Runs inside the pop-up opened from the extension's "Configure…" menu item.
 * It receives the dashboard's worksheets (name, columns, suggested exclusions,
 * suggested sort keys) plus the current settings as a payload, lets the author
 * pick the allow-list, the columns each sheet exports, the row order and the
 * layout, and returns the chosen config to the parent (excel-export.js) which
 * performs the actual save.
 *
 * This page is pure UI — it never reads or writes settings itself, so there is
 * one and only one place that persists config (the parent).
 *
 * Two things the Extensions API cannot tell us, which is why they are asked here
 * rather than detected:
 *   - Which fields sit on the Rows shelf vs the Columns shelf. The API exposes
 *     the marks card (Color / Text / Tooltip …) and nothing about the shelves,
 *     so a crosstab layout has to be named.
 *   - How the worksheet is sorted. There is no sort accessor on Worksheet at
 *     all. But a CUSD viz table carries its own sort columns, so the export can
 *     obey the same field the viz obeys — named here, and left out of the file.
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

  // sheetName -> { allowed, columns, exclude:{name:true}, sort:[{field,dir}],
  //               across:[name], value, pendingCrosstab }
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

  function sortPosition(st, name) {
    for (var i = 0; i < st.sort.length; i++) {
      if (st.sort[i].field === name) { return i; }
    }
    return -1;
  }

  function acrossPosition(st, name) {
    return st.across.indexOf(name);
  }

  function checkboxRow(labelText, checked, onChange) {
    var row = el("label", "col-row");
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = checked;
    cb.addEventListener("change", function () { onChange(cb.checked); });
    row.appendChild(cb);
    row.appendChild(el("span", null, labelText));
    return row;
  }

  // --- one sheet's panel ----------------------------------------------------
  function renderPanel(st, panel) {
    panel.innerHTML = "";
    if (!st.allowed) { return; }

    if (!st.columns.length) {
      panel.appendChild(el("p", "help",
        "This Tableau version won't tell the extension what's on the sheet, so every column will be exported, in the order the data arrives. Everything below needs Tableau 2022.2 or newer."));
      return;
    }

    // ---- 1. columns ----
    var colsBlock = el("div", "sub-block");
    colsBlock.appendChild(el("div", "sub-title", "1. What goes in the file"));
    colsBlock.appendChild(el("p", "help",
      "A worksheet carries more fields than it shows — everything on the Tooltip shelf, plus the sort helpers behind the scenes. Tick only what belongs in the spreadsheet; those start unticked for you."));

    var colList = el("div", "col-list");
    st.columns.forEach(function (name) {
      var pos = sortPosition(st, name);
      var suffix = pos === -1 ? "" : "   (sort key " + (pos + 1) + ")";
      colList.appendChild(checkboxRow(name + suffix, !st.exclude[name], function (on) {
        if (on) { delete st.exclude[name]; }
        else {
          st.exclude[name] = true;
          var ap = acrossPosition(st, name);
          if (ap !== -1) { st.across.splice(ap, 1); }
          if (st.value === name) { st.value = ""; }
        }
        renderPanel(st, panel);
      }));
    });
    colsBlock.appendChild(colList);
    panel.appendChild(colsBlock);

    // ---- 2. order ----
    var sortBlock = el("div", "sub-block");
    sortBlock.appendChild(el("div", "sub-title", "2. What order the rows come out in"));
    sortBlock.appendChild(el("p", "help",
      "Tableau won't tell an extension how a sheet is sorted, so pick the field the sheet sorts by — usually a hidden sort column like Location Sort or Grade Sort. A sort key does NOT have to be in the file: leave it unticked above and it still orders the rows. Tick them in priority order (first ticked breaks ties first). With none picked, rows come out in whatever order the data arrives."));

    var sortList = el("div", "col-list");
    st.columns.forEach(function (name) {
      var pos = sortPosition(st, name);
      var row = el("label", "col-row");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = pos !== -1;
      cb.addEventListener("change", function () {
        if (cb.checked) { st.sort.push({ field: name, dir: "asc" }); }
        else { st.sort.splice(sortPosition(st, name), 1); }
        renderPanel(st, panel);
      });
      row.appendChild(cb);
      row.appendChild(el("span", "sort-rank", pos === -1 ? "" : String(pos + 1) + "."));
      row.appendChild(el("span", null, name));

      if (pos !== -1) {
        var dir = document.createElement("select");
        [["asc", "A → Z / low → high"], ["desc", "Z → A / high → low"]].forEach(function (o) {
          var opt = document.createElement("option");
          opt.value = o[0];
          opt.textContent = o[1];
          opt.selected = st.sort[pos].dir === o[0];
          dir.appendChild(opt);
        });
        dir.addEventListener("change", function () {
          st.sort[sortPosition(st, name)].dir = dir.value;
        });
        row.appendChild(dir);
      }
      sortList.appendChild(row);
    });
    sortBlock.appendChild(sortList);
    panel.appendChild(sortBlock);

    // ---- 3. layout ----
    var layoutBlock = el("div", "sub-block");
    layoutBlock.appendChild(el("div", "sub-title", "3. How the file is laid out"));

    [
      { key: "flat", label: "One row per mark — a plain table, one column per field" },
      { key: "cross", label: "Like the worksheet — a crosstab, with headers across the top" }
    ].forEach(function (opt) {
      var row = el("label", "col-row");
      var radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "layout_" + st.name;
      radio.checked = (opt.key === "cross") === !!st.pendingCrosstab;
      radio.addEventListener("change", function () {
        st.pendingCrosstab = opt.key === "cross";
        if (!st.pendingCrosstab) { st.across = []; st.value = ""; }
        renderPanel(st, panel);
      });
      row.appendChild(radio);
      row.appendChild(el("span", null, opt.label));
      layoutBlock.appendChild(row);
    });

    if (st.pendingCrosstab) {
      var included = includedColumns(st);

      layoutBlock.appendChild(el("div", "sub-title", "Fields across the top"));
      layoutBlock.appendChild(el("p", "help",
        "The same fields that sit on the Columns shelf of the worksheet — one header row each, top to bottom in the order you tick them. THE ORDER DECIDES HOW THE TABLE GROUPS: tick Benchmark Period then School Year and each period spans its years as one merged heading, the way the worksheet reads. Tick them the other way round and the file groups by year instead. Everything else you kept becomes a row heading on the left."));
      included.forEach(function (name) {
        if (name === st.value) { return; }
        var pos = acrossPosition(st, name);
        var row = el("label", "col-row");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = pos !== -1;
        cb.addEventListener("change", function () {
          if (cb.checked) { st.across.push(name); }
          else { st.across.splice(acrossPosition(st, name), 1); }
          renderPanel(st, panel);
        });
        row.appendChild(cb);
        row.appendChild(el("span", "sort-rank", pos === -1 ? "" : String(pos + 1) + "."));
        row.appendChild(el("span", null, pos === 0 ? name + "   (top row)" : name));
        layoutBlock.appendChild(row);
      });

      layoutBlock.appendChild(el("div", "sub-title", "Field that fills the cells"));
      layoutBlock.appendChild(el("p", "help",
        "The number in the body of the crosstab — whatever is on Text in the worksheet. One field; a sheet showing two measures side by side needs the plain-table layout instead."));
      var select = document.createElement("select");
      var blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "— choose a field —";
      select.appendChild(blank);
      included.forEach(function (name) {
        if (acrossPosition(st, name) !== -1) { return; }
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

      if (!st.across.length || !st.value) {
        layoutBlock.appendChild(el("p", "help warn",
          "Not finished — pick at least one field for the top and one for the cells. Until then this sheet exports as a plain table."));
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
      var sort = (prior && Array.isArray(prior.sort))
        ? prior.sort.map(function (e) {
            return { field: e && e.field !== undefined ? e.field : e, dir: (e && e.dir) || "asc" };
          })
        : (s.suggestSort || []).map(function (n) { return { field: n, dir: "asc" }; });
      var across = ((prior && prior.across) || []).slice();
      state[s.name] = {
        name: s.name,
        allowed: !!allowed[s.name],
        columns: s.columns || [],
        exclude: exclude,
        sort: sort,
        across: across,
        value: (prior && prior.value) || "",
        pendingCrosstab: across.length > 0
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
      // TICK order, not column order — the stack decides how the crosstab
      // groups, so the author's sequence is the whole answer here. (This read
      // st.columns before, which silently overrode the pick.)
      var across = st.across.filter(function (c) { return !st.exclude[c]; });
      sheetConfig[name] = {
        exclude: Object.keys(st.exclude),
        sort: st.sort.slice(),
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
