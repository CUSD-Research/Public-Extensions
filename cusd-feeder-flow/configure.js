/*
 * CUSD Feeder Flow — Configure dialog.
 * The parent opens this with a payload of { settings, sheets:[{name, columns}], defaults }.
 * The author picks the worksheet and confirms which column plays which part; Save hands
 * the settings back as JSON and the parent stores them on the workbook.
 */
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  var AUTO = {
    fOrigin:      [/^origin$/i, /^school ?name$/i, /^schoolname$/i, /^origin school$/i],
    fCategory:    [/^transition ?category$/i, /^transitioncategory$/i, /^category$/i],
    fDestination: [/^destination( grouped)?$/i, /^destinationgrouped$/i, /^to ?school$/i, /^toschool$/i, /^exit reason$/i],
    fCount:       [/^student ?count$/i, /^studentcount$/i, /^count$/i, /^students$/i]
  };
  function cleanCaption(c) {
    var s = String(c == null ? "" : c).trim(), m;
    while ((m = /^(?:AGG|SUM|MIN|MAX|AVG|ATTR|CNT|CNTD|MEDIAN|COUNT|COUNTD)\((.*)\)$/i.exec(s))) { s = m[1].trim(); }
    return s;
  }
  function guess(columns, patterns, current) {
    var i, j;
    if (current) { for (i = 0; i < columns.length; i++) { if (cleanCaption(columns[i]) === current || columns[i] === current) { return columns[i]; } } }
    for (j = 0; j < patterns.length; j++) { for (i = 0; i < columns.length; i++) { if (patterns[j].test(cleanCaption(columns[i]))) { return columns[i]; } } }
    return "";
  }

  var data = { settings: {}, sheets: [], defaults: {} };

  function fillSelect(sel, values, chosen, allowBlank) {
    sel.innerHTML = "";
    if (allowBlank) { var o0 = document.createElement("option"); o0.value = ""; o0.textContent = "— choose —"; sel.appendChild(o0); }
    values.forEach(function (v) {
      var o = document.createElement("option"); o.value = v; o.textContent = cleanCaption(v) === v ? v : v + "  (" + cleanCaption(v) + ")";
      if (v === chosen) { o.selected = true; }
      sel.appendChild(o);
    });
  }

  function onSheetChange() {
    var name = $("sheet").value, sheet = null, i;
    for (i = 0; i < data.sheets.length; i++) { if (data.sheets[i].name === name) { sheet = data.sheets[i]; } }
    var cols = sheet ? sheet.columns : [];
    var s = data.settings;
    fillSelect($("fOrigin"), cols, guess(cols, AUTO.fOrigin, s.fieldOrigin), true);
    fillSelect($("fCategory"), cols, guess(cols, AUTO.fCategory, s.fieldCategory), true);
    fillSelect($("fDestination"), cols, guess(cols, AUTO.fDestination, s.fieldDestination), true);
    fillSelect($("fCount"), cols, guess(cols, AUTO.fCount, s.fieldCount), true);
  }

  function init(payload) {
    try { data = JSON.parse(payload) || data; } catch (e) { /* keep empty */ }
    var s = data.settings || {}, d = data.defaults || {};
    fillSelect($("sheet"), data.sheets.map(function (x) { return x.name; }), s.sheetName, true);
    $("stayed").value = s.stayedCategory || d.stayedCategory || "";
    $("includeStayed").value = s.includeStayed === "true" ? "true" : "false";
    $("maxDest").value = s.maxDestinations || d.maxDestinations || "0";
    $("otherLabel").value = s.otherLabel || d.otherLabel || "Other";
    $("title").value = s.title || "";
    $("unit").value = s.unit || "";
    $("originNoun").value = s.originNoun || "";
    $("notStayed").value = s.notStayedPhrase || "";
    $("originFilter").value = s.originFilterName || "";
    $("catOrder").value = s.categoryOrder || "";
    $("catColors").value = s.categoryColors || "";
    $("sheet").addEventListener("change", onSheetChange);
    onSheetChange();
  }

  function save() {
    var cfg = {
      sheetName: $("sheet").value,
      fieldOrigin: cleanCaption($("fOrigin").value),
      fieldCategory: cleanCaption($("fCategory").value),
      fieldDestination: cleanCaption($("fDestination").value),
      fieldCount: cleanCaption($("fCount").value),
      stayedCategory: $("stayed").value.trim() || "Stayed at Same School",
      includeStayed: $("includeStayed").value === "true" ? "true" : "false",
      maxDestinations: String(Math.max(0, parseInt($("maxDest").value, 10) || 0)),
      otherLabel: $("otherLabel").value.trim() || "Other",
      title: $("title").value.trim(),
      unit: $("unit").value.trim() || "students",
      originNoun: $("originNoun").value.trim() || "schools",
      notStayedPhrase: $("notStayed").value.trim() || "did not stay",
      originFilterName: $("originFilter").value.trim() || "School Name",
      categoryOrder: $("catOrder").value.trim(),
      categoryColors: $("catColors").value.trim()
    };
    tableau.extensions.ui.closeDialog(JSON.stringify(cfg));
  }

  $("saveBtn").addEventListener("click", save);
  $("cancelBtn").addEventListener("click", function () { tableau.extensions.ui.closeDialog("cancel"); });

  tableau.extensions.initializeDialogAsync().then(init).catch(function (e) {
    $("sheet").innerHTML = "<option value=''>Could not initialise: " + (e && e.message ? e.message : e) + "</option>";
  });
})();
