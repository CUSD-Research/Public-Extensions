/*
 * CUSD Feeder Flow — the Tableau side.
 * ------------------------------------
 * A dashboard extension that draws where one school's students went the next
 * year. All the drawing is in flow-model.js; this file only talks to Tableau:
 *
 *   1. Read the author's settings (which worksheet feeds the flow, which columns
 *      mean origin / category / destination / count, a few display options).
 *   2. Read that worksheet's SUMMARY data. Summary data is the aggregated query
 *      behind the sheet with row-level security already applied, so a viewer only
 *      ever sees rows they could see on the sheet itself. Nothing is sent anywhere.
 *   3. Turn the rows into { origin, category, destination, count } and render.
 *   4. Re-render when a filter on that worksheet changes, or the object resizes.
 *
 * The worksheet the author points at should carry the four fields on Detail
 * (or Rows) and nothing else, so each summary row is one flow. Filters applied
 * to it on the dashboard -- school, year, grade -- narrow the flow the same way
 * they narrow every other sheet.
 */
(function () {
  "use strict";

  var SETTINGS_DEFAULTS = {
    sheetName: "",
    fieldOrigin: "", fieldCategory: "", fieldDestination: "", fieldCount: "",
    stayedCategory: "Stayed at Same School",
    includeStayed: "false",
    maxDestinations: "0",
    otherLabel: "Other",
    title: "",
    unit: "students",            // what is counted, as it reads in the headline and footer
    originNoun: "schools",       // plural noun for the origins, used when several are drawn
    originFilterName: "School Name",   // named in the message shown when too many origins are selected
    notStayedPhrase: "did not stay",   // after an origin's share, in ribbon tooltips and the footer; "came from here" on an inbound flow
    categoryOrder: "",           // comma-separated, top to bottom; blank = the feeder preset order
    categoryColors: ""           // "Name = #hex; Name = #hex"; unlisted categories take a palette colour
  };

  // Which summary-data column plays which part, when the author has not said.
  // Matched against the cleaned caption, case-insensitively, first hit wins.
  // The feeder names come first; the generic names after them let another question's sheet map
  // without opening Configure, as long as its captions are plain.
  var AUTO = {
    fieldOrigin:      [/^origin$/i, /^school ?name$/i, /^schoolname$/i, /^origin school$/i, /^source$/i, /^from$/i],
    fieldCategory:    [/^transition ?category$/i, /^transitioncategory$/i, /^category$/i, /^type$/i, /^group$/i, /^outcome$/i],
    fieldDestination: [/^destination( grouped)?$/i, /^destinationgrouped$/i, /^to ?school$/i, /^toschool$/i, /^exit reason$/i, /^target$/i, /^to$/i, /^next$/i],
    fieldCount:       [/^student ?count$/i, /^studentcount$/i, /^count$/i, /^students$/i, /^n$/i, /^value$/i, /^total$/i, /^headcount$/i]
  };

  // Configure stores strings; these turn them back into what the model takes.
  // "A, B, C" -> ["A", "B", "C"]; blank -> [].
  function parseList(str) { return String(str || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean); }
  // "A = #123456; B=#abcdef" -> { A: "#123456", B: "#abcdef" }. Only hex colours are kept.
  function parseMap(str) {
    var out = {};
    String(str || "").split(/[;\n]/).forEach(function (pair) {
      var k = pair.indexOf("="); if (k < 0) { return; }
      var name = pair.slice(0, k).trim(), val = pair.slice(k + 1).trim();
      if (name && /^#[0-9a-f]{3,8}$/i.test(val)) { out[name] = val; }
    });
    return out;
  }

  // More origins than this and the left column is a wall of two-line labels with nothing to
  // dodge them, so the extension asks for a School Name instead of drawing. The dashboard's
  // School Name filter opens on All, which makes this the first thing a viewer can meet.
  var MAX_ORIGINS = 8;

  // Null when the rows can be drawn; otherwise the message to show in their place. Origins are
  // counted after dropping zero-count rows, the same rows the model ignores. Pure; the harness
  // calls it directly.
  function originGuard(rows, maxOrigins, filterName) {
    var seen = {}, n = 0, i, r;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if ((Number(r.count) || 0) <= 0 || seen[r.origin]) { continue; }
      seen[r.origin] = true; n += 1;
    }
    if (n <= maxOrigins) { return null; }
    return "Too many origins selected (" + n + "). Pick one " + (filterName || "School Name") + " to draw its flow; up to " + maxOrigins + " draw together.";
  }

  function $(id) { return document.getElementById(id); }

  function getSetting(key) {
    var v = tableau.extensions.settings.get(key);
    return v === undefined || v === null || v === "" ? SETTINGS_DEFAULTS[key] : v;
  }
  function readSettings() {
    var s = {}, k;
    for (k in SETTINGS_DEFAULTS) { if (Object.prototype.hasOwnProperty.call(SETTINGS_DEFAULTS, k)) { s[k] = getSetting(k); } }
    return s;
  }

  // "SUM(studentCount)" -> "studentCount"; "ATTR(School Name)" -> "School Name". Nested wrappers unwrap too.
  function cleanCaption(c) {
    var s = String(c == null ? "" : c).trim(), m;
    while ((m = /^(?:AGG|SUM|MIN|MAX|AVG|ATTR|CNT|CNTD|MEDIAN|COUNT|COUNTD)\((.*)\)$/i.exec(s))) { s = m[1].trim(); }
    return s;
  }

  function pickColumn(columns, wanted, patterns) {
    var i, j;
    if (wanted) {
      for (i = 0; i < columns.length; i++) { if (cleanCaption(columns[i].fieldName) === wanted || columns[i].fieldName === wanted) { return i; } }
    }
    for (j = 0; j < patterns.length; j++) {
      for (i = 0; i < columns.length; i++) { if (patterns[j].test(cleanCaption(columns[i].fieldName))) { return i; } }
    }
    return -1;
  }

  function cellText(dv) {
    if (!dv) { return ""; }
    var f = dv.formattedValue;
    if (f === "%null%" || f === "null" || f == null) { return dv.value == null ? "" : String(dv.value); }
    return String(f);
  }
  function cellNumber(dv) {
    if (!dv) { return 0; }
    var v = dv.value;
    if (typeof v === "number" && isFinite(v)) { return v; }
    var n = parseFloat(String(dv.formattedValue == null ? "" : dv.formattedValue).replace(/[^0-9.\-]/g, ""));
    return isFinite(n) ? n : 0;
  }

  // Summary data -> rows the model understands. Exposed on window for the harness.
  function rowsFromTable(table, settings) {
    var cols = table.columns || [];
    var io = pickColumn(cols, settings.fieldOrigin, AUTO.fieldOrigin);
    var ic = pickColumn(cols, settings.fieldCategory, AUTO.fieldCategory);
    var id = pickColumn(cols, settings.fieldDestination, AUTO.fieldDestination);
    var ik = pickColumn(cols, settings.fieldCount, AUTO.fieldCount);
    var missing = [];
    if (io < 0) { missing.push("origin school"); }
    if (ic < 0) { missing.push("transition category"); }
    if (id < 0) { missing.push("destination"); }
    if (ik < 0) { missing.push("student count"); }
    if (missing.length) { return { error: "The data sheet has no column for: " + missing.join(", ") + ". Open Configure… and map them." }; }
    var rows = [], data = table.data || [], r;
    for (r = 0; r < data.length; r++) {
      rows.push({ origin: cellText(data[r][io]), category: cellText(data[r][ic]), destination: cellText(data[r][id]), count: cellNumber(data[r][ik]) });
    }
    return { rows: rows, columns: { origin: cols[io].fieldName, category: cols[ic].fieldName, destination: cols[id].fieldName, count: cols[ik].fieldName } };
  }

  function findSheet(name) {
    var dashboard = tableau.extensions.dashboardContent.dashboard, i;
    for (i = 0; i < dashboard.worksheets.length; i++) { if (dashboard.worksheets[i].name === name) { return dashboard.worksheets[i]; } }
    return null;
  }

  async function readSheet(worksheet) {
    var reader = await worksheet.getSummaryDataReaderAsync(10000, { ignoreSelection: true });
    try { return await reader.getAllPagesAsync(); }
    finally { try { await reader.releaseAsync(); } catch (e) { /* older API builds have no releaseAsync */ } }
  }

  function showMessage(text, isError) {
    var el = $("status");
    el.textContent = text || "";
    el.classList.toggle("error", !!isError);
    el.hidden = !text;
    $("viz").hidden = !!text;
  }

  var state = { sheet: null, rows: null, settings: null, listener: null };

  function draw() {
    if (!state.rows) { return; }
    var s = state.settings;
    var guard = originGuard(state.rows, MAX_ORIGINS, s.originFilterName);
    if (guard) { showMessage(guard, false); return; }
    var box = $("viz");
    box.hidden = false;                                   // a box hidden behind a message measures 0 x 0
    var w = box.clientWidth || 800, h = box.clientHeight || 400;
    var order = parseList(s.categoryOrder), colors = parseMap(s.categoryColors);
    var opts = {
      stayedCategory: s.stayedCategory,
      includeStayed: s.includeStayed === "true",
      maxDestinations: parseInt(s.maxDestinations, 10) || 0,
      otherLabel: s.otherLabel || "Other",
      title: s.title || "",
      unit: s.unit || "students",
      originNoun: s.originNoun || "schools",
      notStayedPhrase: s.notStayedPhrase || "did not stay",
      categoryOrder: order.length ? order : undefined,              // undefined keeps the feeder preset
      categoryColor: Object.keys(colors).length ? colors : undefined // merged over the preset by the model
    };
    var out = FeederFlow.render(state.rows, w, h, opts);
    if (!out.model.total) { showMessage("No students in the current selection.", false); return; }
    showMessage("", false);
    box.innerHTML = out.svg;
  }

  async function reload() {
    state.settings = readSettings();
    if (!state.settings.sheetName) { showMessage("Open Configure… (from the object's drop-down) and choose the worksheet that feeds this flow.", false); return; }
    var ws = findSheet(state.settings.sheetName);
    if (!ws) { showMessage("Worksheet \"" + state.settings.sheetName + "\" is not on this dashboard. Open Configure… to pick another.", true); return; }
    if (state.sheet !== ws) {
      if (state.sheet && state.listener) { try { state.listener(); } catch (e) { /* already removed */ } }
      state.sheet = ws;
      state.listener = ws.addEventListener(tableau.TableauEventType.FilterChanged, function () { reload().catch(reportError); });
    }
    var table;
    try { table = await readSheet(ws); }
    catch (e) { showMessage("Could not read the data sheet: " + (e && e.message ? e.message : e), true); return; }
    var built = rowsFromTable(table, state.settings);
    if (built.error) { showMessage(built.error, true); return; }
    state.rows = built.rows;
    draw();
  }

  function reportError(e) {
    var msg = e && e.message ? e.message : String(e);
    showMessage("Feeder Flow could not start: " + msg, true);
  }

  async function describeSheets() {
    var dashboard = tableau.extensions.dashboardContent.dashboard, out = [], i;
    for (i = 0; i < dashboard.worksheets.length; i++) {
      var ws = dashboard.worksheets[i], captions = [];
      try {
        var t = await ws.getSummaryDataAsync({ maxRows: 1, ignoreSelection: true });
        captions = (t.columns || []).map(function (c) { return c.fieldName; });
      } catch (e) { captions = []; }
      out.push({ name: ws.name, columns: captions });
    }
    return out;
  }

  function openConfigure() {
    var url = new URL("./configure.html", window.location.href).href;
    return describeSheets().then(function (sheets) {
      var payload = JSON.stringify({ settings: readSettings(), sheets: sheets, defaults: SETTINGS_DEFAULTS });
      return tableau.extensions.ui.displayDialogAsync(url, payload, { height: 820, width: 560 });
    }).then(function (result) {
      if (!result || result === "cancel") { return; }
      var cfg = JSON.parse(result), k;
      for (k in cfg) { if (Object.prototype.hasOwnProperty.call(cfg, k)) { tableau.extensions.settings.set(k, String(cfg[k])); } }
      return tableau.extensions.settings.saveAsync().then(function () { return reload(); });
    }).catch(function (e) {
      if (e && e.errorCode === tableau.ErrorCodes.DialogClosedByUser) { return; }
      reportError(e);
    });
  }

  // Exposed for the offline harness (tests/test_feeder_flow_extension.js).
  window.__FeederFlowGlue = { rowsFromTable: rowsFromTable, cleanCaption: cleanCaption, pickColumn: pickColumn, AUTO: AUTO, originGuard: originGuard, MAX_ORIGINS: MAX_ORIGINS, parseList: parseList, parseMap: parseMap, SETTINGS_DEFAULTS: SETTINGS_DEFAULTS };

  // --- bootstrap
  tableau.extensions.initializeAsync({ configure: openConfigure })
    .then(function () {
      var t = null;
      window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(draw, 120); });
      return reload();
    })
    .catch(reportError);
})();
