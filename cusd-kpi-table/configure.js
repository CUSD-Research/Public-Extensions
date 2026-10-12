/*
 * CUSD KPI Table — Configure dialog (configure.js)
 * ------------------------------------------------
 * Author-only. The parent (kpi-table.js) passes in a CATALOG (every sheet's
 * field names + a small sample of rows) plus the CURRENT config. This dialog
 * never reads dashboard data itself — it works entirely off that payload, which
 * is what lets every picker be a dropdown of REAL field names and lets the
 * preview render the author's own sample rows live.
 *
 * Progressive disclosure: each renderer declares its inputs in KPI.RENDERER_META
 * (needs/opts). A column card shows ONLY those controls, so configuring a KPI
 * column is answering 2-3 dropdowns — and the comparison basis (static value vs
 * a fixed calc field, "higher is better") is a first-class, reusable control.
 */
(function () {
  "use strict";

  var P = KPI.PALETTE;
  var META = KPI.RENDERER_META;
  var catalog = {};
  var state = {};
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- catalog helpers ---------- */
  function sheetNames() { return Object.keys(catalog); }
  function fieldsOf(sheet) { return (catalog[sheet] && catalog[sheet].fields) || []; }
  function sampleOf(sheet) { return (catalog[sheet] && catalog[sheet].sample) || []; }

  /* ---------- tiny DOM helpers ---------- */
  function mk(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === "class") e.className = props[k];
      else if (k === "html") e.innerHTML = props[k];
      else if (k === "text") e.textContent = props[k];
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), props[k]);
      else e.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function optionsHtml(values, current, includeNone, noneLabel) {
    var h = includeNone ? '<option value="">' + (noneLabel || "(none)") + "</option>" : "";
    values.forEach(function (v) { h += '<option value="' + KPI.esc(v) + '"' + (v === current ? " selected" : "") + ">" + KPI.esc(v) + "</option>"; });
    return h;
  }
  function fieldSelect(current, onchange, includeNone) {
    return mk("select", { html: optionsHtml(fieldsOf(state.sourceSheet), current, includeNone), onchange: onchange });
  }
  function colorInput(value, oninput) { return mk("input", { type: "color", value: value || P.blue, oninput: oninput }); }
  function numInput(value, oninput) { return mk("input", { type: "number", step: "any", value: (value == null ? "" : value), oninput: oninput }); }
  function ctrl(labelText, hint, inputs) {
    return mk("div", { class: "ctrl" }, [mk("span", { class: "ctrl-lbl" }, [labelText, hint ? mk("em", { text: " " + hint }) : null])].concat(inputs));
  }

  /* ---------- state ---------- */
  function defaultColumn() {
    var f0 = fieldsOf(state.sourceSheet)[0] || "";
    return {
      header: f0, renderer: "number", valueField: f0, subField: "", suffix: "",
      maxMode: "constant", maxConstant: 100, maxField: f0,
      targetMode: "none", targetConstant: 0, targetField: f0,
      cmpMode: "none", cmpConstant: 0, cmpField: f0, higherIsBetter: true, eps: 0,
      colorMode: "fixed", fixedColor: P.blue, thresholds: [], categoryMap: [],
      goodColor: P.green, badColor: P.red, neutralColor: P.gray
    };
  }
  function applyRendererDefaults(col) {
    if (col.renderer === "pie" || col.renderer === "donut") { if (!(col.maxConstant > 0)) col.maxConstant = 100; col.maxMode = col.maxMode || "constant"; }
    if (col.renderer === "rateOverBar" && !(col.maxConstant > 0)) col.maxConstant = 20;
    if (col.renderer === "bar" && !(col.maxConstant > 0)) col.maxConstant = 100;
  }

  /* ---------- data-source controls ---------- */
  function populateData() {
    $("srcSheet").innerHTML = optionsHtml(sheetNames(), state.sourceSheet);
    $("density").value = state.density || "comfortable";
    refreshFieldControls();

    $("srcSheet").onchange = function () {
      state.sourceSheet = this.value;
      if (fieldsOf(state.sourceSheet).indexOf(state.rowField) < 0) state.rowField = fieldsOf(state.sourceSheet)[0] || "";
      refreshFieldControls(); renderColumns(); preview();
    };
    $("rowField").onchange = function () { state.rowField = this.value; preview(); };
    $("rowSubField").onchange = function () { state.rowSubField = this.value; preview(); };
    $("rowHeader").oninput = function () { state.rowHeader = this.value; preview(); };
    $("density").onchange = function () { state.density = this.value; preview(); };
    $("timeField").onchange = function () { state.timeField = this.value; renderColumns(); preview(); };
    $("sparkMode").value = state.sparkClip === false ? "full" : "clip";
    $("sparkMode").onchange = function () { state.sparkClip = (this.value === "clip"); preview(); };
    $("showYearSelector").checked = state.showYearSelector === true;
    $("showYearSelector").onchange = function () { state.showYearSelector = this.checked; };

    $("exportEnabled").checked = state.exportEnabled !== false;
    $("exportPrefix").value = state.exportPrefix || "";
    $("exportAbout").checked = state.exportAbout !== false;
    $("exportEnabled").onchange = function () { state.exportEnabled = this.checked; };
    $("exportPrefix").oninput = function () { state.exportPrefix = this.value; };
    $("exportAbout").onchange = function () { state.exportAbout = this.checked; };
  }
  function refreshFieldControls() {
    var f = fieldsOf(state.sourceSheet);
    $("rowField").innerHTML = optionsHtml(f, state.rowField);
    $("rowSubField").innerHTML = optionsHtml(f, state.rowSubField, true);
    $("rowHeader").value = state.rowHeader || "";
    $("timeField").innerHTML = optionsHtml(f, state.timeField, true);
  }

  /* ---------- per-column controls ---------- */
  function maxControl(col) {
    var inner = mk("span", { class: "ctrl-inner" });
    function redraw() {
      inner.innerHTML = "";
      if (col.maxMode === "field") inner.appendChild(fieldSelect(col.maxField, function () { col.maxField = this.value; preview(); }));
      else inner.appendChild(numInput(col.maxConstant, function () { col.maxConstant = this.value; preview(); }));
    }
    var mode = mk("select", { html: '<option value="constant">a constant</option><option value="field">a field</option>', onchange: function () { col.maxMode = this.value; redraw(); preview(); } });
    mode.value = col.maxMode || "constant"; redraw();
    return ctrl("100% point is", "(full bar / whole pie)", [mode, inner]);
  }
  function targetControl(col) {
    var inner = mk("span", { class: "ctrl-inner" });
    function redraw() {
      inner.innerHTML = "";
      if (col.targetMode === "constant") inner.appendChild(numInput(col.targetConstant, function () { col.targetConstant = this.value; preview(); }));
      else if (col.targetMode === "field") inner.appendChild(fieldSelect(col.targetField, function () { col.targetField = this.value; preview(); }));
    }
    var mode = mk("select", { html: '<option value="none">none</option><option value="constant">a constant</option><option value="field">a field</option>', onchange: function () { col.targetMode = this.value; redraw(); preview(); } });
    mode.value = col.targetMode || "none"; redraw();
    return ctrl("Target line", "", [mode, inner]);
  }
  function compareControl(col) {
    var inner = mk("span", { class: "ctrl-inner" });
    function redraw() {
      inner.innerHTML = "";
      if (col.cmpMode === "constant") inner.appendChild(numInput(col.cmpConstant, function () { col.cmpConstant = this.value; preview(); }));
      else if (col.cmpMode === "field") inner.appendChild(fieldSelect(col.cmpField, function () { col.cmpField = this.value; preview(); }));
    }
    var mode = mk("select", {
      html: '<option value="none">nothing (or a yes/no flag)</option><option value="constant">a goal value</option><option value="field">a comparison field</option>',
      onchange: function () { col.cmpMode = this.value; redraw(); preview(); }
    });
    mode.value = col.cmpMode || "none"; redraw();
    var hib = mk("label", { class: "ctrl-chk" }, [mk("input", { type: "checkbox", onchange: function () { col.higherIsBetter = this.checked; preview(); } }), "higher is better"]);
    hib.querySelector("input").checked = col.higherIsBetter !== false;
    return ctrl("Compare against", "(field = e.g. a FIXED district-avg calc)", [mode, inner, hib]);
  }
  function thresholdEditor(col) {
    var box = mk("div", { class: "list-edit" });
    (col.thresholds || []).forEach(function (band, i) {
      box.appendChild(mk("div", { class: "list-row" }, [
        mk("span", { class: "le-pre", text: "≥" }),
        numInput(band.min, function () { col.thresholds[i].min = this.value; preview(); }),
        colorInput(band.color, function () { col.thresholds[i].color = this.value; preview(); }),
        mk("button", { class: "btn btn-x", type: "button", text: "×", onclick: function () { col.thresholds.splice(i, 1); renderColumns(); preview(); } })
      ]));
    });
    box.appendChild(mk("button", { class: "btn btn-ghost btn-sm", type: "button", text: "+ band", onclick: function () { (col.thresholds || (col.thresholds = [])).push({ min: 0, color: P.amber }); renderColumns(); preview(); } }));
    return box;
  }
  function categoryEditor(col) {
    var box = mk("div", { class: "list-edit" });
    (col.categoryMap || []).forEach(function (m, i) {
      box.appendChild(mk("div", { class: "list-row" }, [
        mk("input", { type: "text", value: m.value, placeholder: "value", oninput: function () { col.categoryMap[i].value = this.value; preview(); } }),
        colorInput(m.color, function () { col.categoryMap[i].color = this.value; preview(); }),
        mk("button", { class: "btn btn-x", type: "button", text: "×", onclick: function () { col.categoryMap.splice(i, 1); renderColumns(); preview(); } })
      ]));
    });
    box.appendChild(mk("button", { class: "btn btn-ghost btn-sm", type: "button", text: "+ value", onclick: function () { (col.categoryMap || (col.categoryMap = [])).push({ value: "", color: P.blue }); renderColumns(); preview(); } }));
    return box;
  }
  function colorControl(col) {
    var inner = mk("div", { class: "ctrl-inner-block" });
    function redraw() {
      inner.innerHTML = "";
      if (col.colorMode === "fixed") inner.appendChild(colorInput(col.fixedColor, function () { col.fixedColor = this.value; preview(); }));
      else if (col.colorMode === "threshold") inner.appendChild(thresholdEditor(col));
      else if (col.colorMode === "category") inner.appendChild(categoryEditor(col));
      else if (col.colorMode === "comparison") {
        inner.appendChild(mk("div", { class: "tri" }, [
          mk("label", {}, ["good ", colorInput(col.goodColor, function () { col.goodColor = this.value; preview(); })]),
          mk("label", {}, ["bad ", colorInput(col.badColor, function () { col.badColor = this.value; preview(); })]),
          mk("label", {}, ["same ", colorInput(col.neutralColor, function () { col.neutralColor = this.value; preview(); })])
        ]));
        inner.appendChild(mk("p", { class: "cfg-note", text: "Set the basis under “Compare against” above." }));
      }
    }
    var mode = mk("select", {
      html: '<option value="fixed">one fixed color</option><option value="threshold">thresholds (value bands)</option><option value="comparison">comparison (good/bad)</option><option value="category">category (text → color)</option>',
      onchange: function () { col.colorMode = this.value; redraw(); preview(); }
    });
    mode.value = col.colorMode || "fixed"; redraw();
    return ctrl("Color by", "", [mode, inner]);
  }

  function columnBody(col) {
    var meta = META[col.renderer] || { needs: ["value"], opts: [] };
    var has = function (k) { return meta.needs.indexOf(k) >= 0 || meta.opts.indexOf(k) >= 0; };
    var body = mk("div", { class: "col-card-body" });

    if (col.renderer === "sparkline") {
      body.appendChild(ctrl("Value field", "(trends over the time dimension)", [fieldSelect(col.valueField, function () { col.valueField = this.value; preview(); })]));
      if (!state.timeField) body.appendChild(mk("p", { class: "cfg-note", text: "Set the Time dimension in section 1 for this to draw." }));
      return body;
    }

    if (has("value")) body.appendChild(ctrl("Value field", "", [fieldSelect(col.valueField, function () { col.valueField = this.value; preview(); })]));
    if (has("sub")) body.appendChild(ctrl("Second line", "", [fieldSelect(col.subField, function () { col.subField = this.value; preview(); }, true)]));
    if (has("max")) body.appendChild(maxControl(col));
    if (has("target")) body.appendChild(targetControl(col));
    if (has("compare")) body.appendChild(compareControl(col));
    if (has("color")) body.appendChild(colorControl(col));
    if (has("fixedColor")) body.appendChild(ctrl("Color", "", [colorInput(col.fixedColor, function () { col.fixedColor = this.value; preview(); })]));
    if (has("suffix")) body.appendChild(ctrl("Suffix", "(e.g. %)", [mk("input", { type: "text", value: col.suffix || "", oninput: function () { col.suffix = this.value; preview(); } })]));
    return body;
  }

  function columnCard(col, idx) {
    var rsel = mk("select", { class: "col-renderer", onchange: function () { col.renderer = this.value; applyRendererDefaults(col); renderColumns(); preview(); } });
    rsel.innerHTML = Object.keys(META).map(function (k) { return '<option value="' + k + '"' + (k === col.renderer ? " selected" : "") + ">" + KPI.esc(META[k].label) + "</option>"; }).join("");

    var top = mk("div", { class: "col-card-top" }, [
      mk("input", { class: "col-header", type: "text", value: col.header || "", placeholder: "Column header", oninput: function () { col.header = this.value; preview(); } }),
      rsel,
      mk("div", { class: "col-actions" }, [
        mk("button", { class: "btn btn-x", type: "button", title: "Move up", text: "↑", onclick: function () { if (idx > 0) { state.columns.splice(idx - 1, 0, state.columns.splice(idx, 1)[0]); renderColumns(); preview(); } } }),
        mk("button", { class: "btn btn-x", type: "button", title: "Move down", text: "↓", onclick: function () { if (idx < state.columns.length - 1) { state.columns.splice(idx + 1, 0, state.columns.splice(idx, 1)[0]); renderColumns(); preview(); } } }),
        mk("button", { class: "btn btn-x", type: "button", title: "Remove", text: "🗑", onclick: function () { state.columns.splice(idx, 1); renderColumns(); preview(); } })
      ])
    ]);
    return mk("div", { class: "col-card" }, [top, columnBody(col)]);
  }

  function renderColumns() {
    var box = $("columns"); box.innerHTML = "";
    if (!state.columns.length) box.appendChild(mk("p", { class: "cfg-note", text: "No columns yet — click “+ Add column”." }));
    state.columns.forEach(function (col, i) { box.appendChild(columnCard(col, i)); });
  }

  /* ---------- preview ---------- */
  function preview() {
    var rows = sampleOf(state.sourceSheet);
    var t = $("preview");
    t.className = "kpi" + (state.density === "compact" ? " compact" : "");
    try { t.innerHTML = KPI.renderTableInner(state, rows); }
    catch (e) { t.innerHTML = '<tbody><tr><td class="muted">Preview unavailable</td></tr></tbody>'; }
  }

  /* ---------- save / cancel ---------- */
  function showError(msg) { var e = $("cfgError"); e.textContent = msg; e.style.display = msg ? "block" : "none"; }
  function onSave() {
    if (!state.sourceSheet) return showError("Pick a source worksheet.");
    if (!state.rowField) return showError("Choose what each row is.");
    if (!state.columns.length) return showError("Add at least one column.");
    tableau.extensions.ui.closeDialog(JSON.stringify(state));
  }

  /* ---------- boot ---------- */
  tableau.extensions.initializeDialogAsync().then(function (openPayload) {
    var data = {};
    try { data = JSON.parse(openPayload) || {}; } catch (e) { data = {}; }
    catalog = data.catalog || {};
    var cur = data.current || {};
    state = {
      sourceSheet: cur.sourceSheet || sheetNames()[0] || "",
      rowField: cur.rowField || "", rowSubField: cur.rowSubField || "", rowHeader: cur.rowHeader || "",
      density: cur.density || "comfortable",
      timeField: cur.timeField || "", showYearSelector: cur.showYearSelector === true, sparkClip: cur.sparkClip !== false,
      exportEnabled: cur.exportEnabled !== false, exportPrefix: cur.exportPrefix || "", exportAbout: cur.exportAbout !== false,
      columns: Array.isArray(cur.columns) ? cur.columns : []
    };
    if (!state.rowField) state.rowField = fieldsOf(state.sourceSheet)[0] || "";

    populateData();
    renderColumns();
    preview();
    $("addColumn").addEventListener("click", function () { state.columns.push(defaultColumn()); renderColumns(); preview(); });
    $("saveBtn").addEventListener("click", onSave);
    $("cancelBtn").addEventListener("click", function () { tableau.extensions.ui.closeDialog("cancel"); });
  }).catch(function (err) {
    console.error("Configure dialog failed to initialize:", err);
    showError("Could not load the dashboard’s worksheets.");
  });
})();
