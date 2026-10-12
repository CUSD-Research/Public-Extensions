/*
 * CUSD Excel Export — in-dashboard logic
 * --------------------------------------
 * A Tableau Dashboard Extension that adds a one-click "Download to Excel" button.
 * The dashboard author decides (via the Configure… dialog) WHICH worksheets the
 * button is allowed to export, WHICH columns come along, and WHETHER the file is
 * a flat table or a crosstab shaped like the worksheet. End users click once and
 * get an .xlsx — no prompts.
 *
 * Guardrails baked in for CUSD:
 *   1. Allow-list only. The button exports ONLY worksheets the author explicitly
 *      enabled. A hidden/underlying sheet that was never enabled cannot be dumped.
 *   2. Summary data only. We read getSummaryDataReaderAsync (the aggregated data
 *      shown on screen), never the row-level underlying data. RLS is respected
 *      automatically because we read what the signed-in user already sees.
 *   3. Optional confidentiality "About" tab + a CUSD-convention file name.
 *
 * BACK-COMPATIBILITY: every workbook already running this extension pulls this
 * file from the hosted URL, so changes here reach all of them at once. Column
 * exclusions and the crosstab layout are therefore stored per workbook and
 * default to "every column, flat table" — an existing workbook that never opens
 * Configure again behaves exactly as it did before.
 *
 * No district data leaves the browser: data is read from the rendered viz and
 * written straight into a local file with SheetJS.
 */
(function () {
  "use strict";

  // Settings keys (stored per-extension-instance via tableau.extensions.settings).
  var KEYS = {
    allowedSheets: "allowedSheets",   // JSON array of worksheet names
    sheetConfig: "sheetConfig",       // JSON { sheetName: {exclude, sort, across, value} }
    filenamePrefix: "filenamePrefix", // string
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

  function getJsonSetting(key, fallback) {
    try {
      var raw = tableau.extensions.settings.get(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function getAllowedSheets() {
    var arr = getJsonSetting(KEYS.allowedSheets, []);
    return Array.isArray(arr) ? arr : [];
  }

  // Per-sheet column/layout choices. Absent (a workbook configured before this
  // existed) means "every column, flat table" — the previous behaviour.
  function getSheetConfig(sheetName) {
    var all = getJsonSetting(KEYS.sheetConfig, {}) || {};
    var cfg = all[sheetName] || {};
    return {
      exclude: Array.isArray(cfg.exclude) ? cfg.exclude : [],
      sort: Array.isArray(cfg.sort) ? cfg.sort : [],
      across: Array.isArray(cfg.across) ? cfg.across : [],
      value: typeof cfg.value === "string" ? cfg.value : ""
    };
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

  // --- header names ---------------------------------------------------------
  // Tableau hands back the pill caption, so a measure arrives as "AVG(Pct At
  // Above)" and a dimension pinned to one value as "ATTR(Common Name)". Nobody
  // reading the spreadsheet wants the aggregation wrapper, so strip it.
  //
  // Only this closed list is unwrapped, and only when it wraps the WHOLE name.
  // Date parts (YEAR(...), MONTH(...)) and anything unrecognised are left alone,
  // because there the wrapper is part of what the column means.
  var AGG_WRAPPER = /^(AGG|ATTR|SUM|AVG|MIN|MAX|CNT|CNTD|COUNT|COUNTD|MEDIAN|PCT|PERCENTILE|STDEV|STDEVP|VAR|VARP|TOTAL)\s*\((.*)\)$/i;

  function prettyHeader(name) {
    var s = String(name === null || name === undefined ? "" : name).trim();
    // Nested wrappers (AGG(SUM(x))) do happen; unwrap a few times, never forever.
    for (var i = 0; i < 5 && AGG_WRAPPER.test(s); i++) {
      s = s.replace(AGG_WRAPPER, "$2").trim();
    }
    return s || String(name);
  }

  // Two different pills can clean to the same word — Grade on Rows and the same
  // field as ATTR(Grade) on Tooltip both become "Grade". Number the duplicate
  // rather than falling back to the raw caption: the wrapper is the thing being
  // removed, so putting it back on the collision defeats the point. In practice
  // the duplicate is the tooltip copy and is usually excluded anyway.
  function uniqueHeaders(rawNames) {
    var used = {}, out = [];
    rawNames.forEach(function (raw) {
      var name = prettyHeader(raw);
      var candidate = name, i = 2;
      while (used[candidate.toLowerCase()]) { candidate = name + " (" + i + ")"; i++; }
      used[candidate.toLowerCase()] = true;
      out.push(candidate);
    });
    return out;
  }

  // --- cell values ----------------------------------------------------------
  // A cell is { v: string|number, z: excel-number-format|undefined }.
  var EMPTY = { v: "" };

  function repeatZeros(n) {
    var s = "";
    for (var i = 0; i < n; i++) { s += "0"; }
    return s;
  }

  // Keep a number a NUMBER in Excel (so it sorts and averages), and rebuild the
  // number format from the way Tableau formatted that same value, so a percent
  // still reads as a percent in the spreadsheet instead of arriving as text.
  function numericCell(value, text) {
    var digits = text.replace(/[^0-9.\-]/g, "");
    var parsed = parseFloat(digits);
    if (!isFinite(parsed)) { return { v: value }; }

    var dot = digits.indexOf(".");
    var decimals = dot === -1 ? 0 : Math.min(digits.length - dot - 1, 6);
    var body = (/\d,\d{3}/.test(text) ? "#,##0" : "0") + (decimals ? "." + repeatZeros(decimals) : "");

    if (/%\s*$/.test(text)) {
      // Tableau can reach "60.4%" from either 60.4 (a plain number carrying a
      // "%" suffix in its format) or 0.604 (a true percentage). Excel's percent
      // format multiplies by 100, so guessing wrong is off by 100x — decide by
      // checking which of the two the underlying value actually is.
      // Compare magnitudes: a negative reaches us as "-5.0%" from -0.05, so the
      // sign is on both sides and only the scale is in question.
      var magnitude = Math.abs(value);
      var tolerance = magnitude * 1e-4 + 1e-9;
      var asIs = Math.abs(Math.abs(parsed) - magnitude) <= tolerance;
      var scaled = Math.abs(Math.abs(parsed) - magnitude * 100) <= tolerance * 100;
      if (asIs) { return { v: value, z: body + '"%"' }; }
      if (scaled) { return { v: value, z: body + "%" }; }
      return { v: value, z: body + '"%"' };
    }
    if (/^\s*[-(]?\s*\$/.test(text)) { return { v: value, z: '"$"' + body }; }
    return { v: value, z: body };
  }

  // Null must land as a genuinely empty cell — never the word "null", which is
  // what a straight formattedValue read produces.
  function toCell(dv) {
    if (!dv) { return EMPTY; }
    var raw = dv.value;
    if (raw === null || raw === undefined) { return EMPTY; }
    var text = dv.formattedValue;
    if (text === null || text === undefined) { return EMPTY; }
    text = String(text);
    var trimmed = text.trim();
    if (trimmed === "" || trimmed.toLowerCase() === "%null%") { return EMPTY; }
    if (typeof raw === "number" && isFinite(raw)) { return numericCell(raw, text); }
    return { v: text };
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

  // Read every page of one worksheet's summary data, in the sheet's on-screen
  // column order, as { headers: [cleaned names], rows: [[cell, …]] }.
  async function readSheet(worksheet) {
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
      var headers = null, rows = [];
      var order = null; // reader-column indices, in view order (set on first page)
      for (var p = 0; p < reader.pageCount; p++) {
        var page = await reader.getPageAsync(p);
        if (order === null) {
          order = buildColumnOrder(page.columns, viewCols);
          headers = uniqueHeaders(order.map(function (ci) { return page.columns[ci].fieldName; }));
        }
        for (var r = 0; r < page.data.length; r++) {
          var row = page.data[r];
          rows.push(order.map(function (ci) { return toCell(row[ci]); }));
        }
      }
      return { headers: headers || [], rows: rows };
    } finally {
      await reader.releaseAsync(); // free the reader even if a page errors
    }
  }

  // --- sort order -----------------------------------------------------------
  // The Extensions API exposes no way to read a worksheet's sort — there is no
  // sort accessor on Worksheet at all — so the export cannot copy the viz's row
  // order directly. What it CAN do is order by the same thing the viz orders by:
  // CUSD viz tables carry explicit sort columns (locationSort, gradeSort,
  // benchmarkPeriodSort), and a sheet sorted by one has that field in its data.
  //
  // So a field can be a sort key and still be left out of the file. "Don't export
  // this column" and "don't use this column" are different instructions, and the
  // sort keys are exactly the fields you want obeyed but never printed.
  function sortKeyIndices(headers, sortSpec) {
    var byName = {};
    headers.forEach(function (h, i) { byName[h.toLowerCase()] = i; });
    var keys = [];
    (sortSpec || []).forEach(function (entry) {
      var name = entry && (entry.field !== undefined ? entry.field : entry);
      var i = byName[String(name || "").toLowerCase()];
      if (i === undefined) { return; }  // field renamed away — skip, don't break
      keys.push({ idx: i, desc: !!(entry && entry.dir === "desc") });
    });
    return keys;
  }

  // Numbers numerically, text naturally ("GRADE 2" before "GRADE 10"), blanks last
  // in both directions — an empty cell is missing data, not a smallest value.
  function compareCells(a, b) {
    var av = a && a.v, bv = b && b.v;
    var aEmpty = (av === "" || av === null || av === undefined);
    var bEmpty = (bv === "" || bv === null || bv === undefined);
    if (aEmpty || bEmpty) { return aEmpty && bEmpty ? 0 : (aEmpty ? 1 : -1); }
    if (typeof av === "number" && typeof bv === "number") { return av - bv; }
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
  }

  // Stable: ties keep the order the data arrived in, which is the viz's own.
  function sortByKeys(items, keys, cellsOf) {
    if (!keys.length) { return items; }
    return items
      .map(function (item, i) { return { item: item, i: i }; })
      .sort(function (a, b) {
        var ca = cellsOf(a.item), cb = cellsOf(b.item);
        for (var k = 0; k < keys.length; k++) {
          var c = compareCells(ca[keys[k].idx], cb[keys[k].idx]);
          if (c) { return keys[k].desc ? -c : c; }
        }
        return a.i - b.i;
      })
      .map(function (x) { return x.item; });
  }

  // --- layout ---------------------------------------------------------------
  // A grid is { aoa, fmt, merges }: values, a parallel matrix of Excel number
  // formats, and any header merges. Kept parallel rather than handing SheetJS
  // cell objects, because aoa_to_sheet reads plain values.
  function newGrid() {
    return { aoa: [], fmt: [], merges: [] };
  }

  function pushRow(grid, cells) {
    grid.aoa.push(cells.map(function (c) { return c.v; }));
    grid.fmt.push(cells.map(function (c) { return c.z; }));
  }

  function keepIndices(headers, exclude) {
    var drop = {};
    (exclude || []).forEach(function (n) { drop[String(n).toLowerCase()] = true; });
    var keep = [];
    headers.forEach(function (h, i) { if (!drop[h.toLowerCase()]) { keep.push(i); } });
    // Never let a stale config empty the sheet out entirely.
    return keep.length ? keep : headers.map(function (_, i) { return i; });
  }

  function flatGrid(headers, rows, keep, sortKeys) {
    var grid = newGrid();
    pushRow(grid, keep.map(function (i) { return { v: headers[i] }; }));
    sortByKeys(rows, sortKeys || [], function (row) { return row; }).forEach(function (row) {
      pushRow(grid, keep.map(function (i) { return row[i] || EMPTY; }));
    });
    return grid;
  }

  // Rebuild the worksheet's crosstab shape: the author's "across" field(s) become
  // stacked header rows, every other kept field becomes a row header, and the
  // chosen value field fills the body.
  //
  // The Extensions API does NOT expose which fields sit on Rows vs Columns — the
  // visual specification covers the marks card only — so this layout is declared
  // in Configure rather than inferred. Column and row order follow first
  // appearance in the summary data, which is the order the viz hands back.
  function crosstabGrid(headers, rows, keep, acrossNames, valueName, sortKeys) {
    var byName = {};
    keep.forEach(function (i) { byName[headers[i].toLowerCase()] = i; });

    var acrossIdx = [];
    (acrossNames || []).forEach(function (n) {
      var i = byName[String(n).toLowerCase()];
      if (i !== undefined && acrossIdx.indexOf(i) === -1) { acrossIdx.push(i); }
    });
    var valueIdx = byName[String(valueName || "").toLowerCase()];

    // Not enough of the declared layout survives (fields renamed or removed) —
    // fall back to the flat table rather than emit a broken crosstab.
    if (!acrossIdx.length || valueIdx === undefined) { return flatGrid(headers, rows, keep, sortKeys); }

    var downIdx = keep.filter(function (i) {
      return acrossIdx.indexOf(i) === -1 && i !== valueIdx;
    });

    // Unit separator: a delimiter no school, grade or period label contains.
    var SEP = "\u001F";

    function text(cell) {
      return String(cell && cell.v !== undefined && cell.v !== null ? cell.v : "");
    }
    function joinKey(row, idxs) {
      return idxs.map(function (i) { return text(row[i]); }).join(SEP);
    }

    var colKeys = [], colSeen = {}, colParts = {}, colSortCells = {};
    var rowKeys = [], rowSeen = {}, rowCells = {}, rowSortCells = {};
    var body = {};

    // A sort key orders whichever axis it is CONSTANT along: a gradeSort varies
    // down the rows and reads the same all the way across, so it orders the
    // rows; a benchmarkPeriodSort that varies across the top orders the columns.
    // A key constant along neither axis disagrees with itself inside a single
    // crosstab cell and cannot order anything, so it is dropped, not guessed at.
    var keys = sortKeys || [];
    var rowConstant = keys.map(function () { return true; });
    var colConstant = keys.map(function () { return true; });

    // Each axis is then ordered by its OWN fields, in the order they are stacked
    // — this is what makes the crosstab group the way the worksheet groups. With
    // Benchmark Period above School Year, all of BOY's years sit together and
    // BOY merges across them; ordering by the year first instead would group by
    // year and leave every period heading standing alone, which is the same
    // header rows arranged into a different table.
    //
    // The ordering value is each value's FIRST-APPEARANCE rank, not the value
    // itself: the data already arrives BOY, MOY, EOY and alphabetising that
    // would read BOY, EOY, MOY. So this imposes the nesting without inventing an
    // order inside a level.
    var ranks = {};
    function rankOf(i, cell) {
      var reg = ranks[i] || (ranks[i] = { next: 0, map: {} });
      var t = text(cell);
      if (reg.map[t] === undefined) { reg.map[t] = reg.next++; }
      return reg.map[t];
    }

    function noteConstancy(store, groupKey, row, flags) {
      var prior = store[groupKey];
      if (!prior) {
        store[groupKey] = keys.map(function (k) { return row[k.idx] || EMPTY; });
        return;
      }
      keys.forEach(function (k, n) {
        if (flags[n] && compareCells(prior[n], row[k.idx] || EMPTY) !== 0) { flags[n] = false; }
      });
    }

    rows.forEach(function (row) {
      acrossIdx.forEach(function (i) { rankOf(i, row[i] || EMPTY); });
      downIdx.forEach(function (i) { rankOf(i, row[i] || EMPTY); });

      var ck = joinKey(row, acrossIdx);
      if (!colSeen[ck]) {
        colSeen[ck] = true;
        colKeys.push(ck);
        colParts[ck] = acrossIdx.map(function (i) { return row[i] || EMPTY; });
      }
      noteConstancy(colSortCells, ck, row, colConstant);

      var rk = joinKey(row, downIdx);
      if (!rowSeen[rk]) {
        rowSeen[rk] = true;
        rowKeys.push(rk);
        rowCells[rk] = downIdx.map(function (i) { return row[i] || EMPTY; });
      }
      noteConstancy(rowSortCells, rk, row, rowConstant);

      body[rk + SEP + ck] = row[valueIdx] || EMPTY;
    });

    // One ordering tuple per group: the sort-key cells first, then one
    // first-appearance rank per axis field, in stacking order. Positions are
    // fixed, so the comparator addresses them by index rather than by name.
    function tuple(sortCells, partCells, idxs) {
      return sortCells.concat(partCells.map(function (cell, p) {
        return { v: rankOf(idxs[p], cell) };
      }));
    }
    var colTuple = {}, rowTuple = {};
    colKeys.forEach(function (ck) { colTuple[ck] = tuple(colSortCells[ck], colParts[ck], acrossIdx); });
    rowKeys.forEach(function (rk) { rowTuple[rk] = tuple(rowSortCells[rk], rowCells[rk], downIdx); });

    // An explicit sort key outranks the field's own order — that is the point of
    // designating one — but only on the axis it is constant along. The stacking
    // ranks follow, and settle everything the keys leave tied.
    function axisComparator(flags, idxs) {
      var out = [];
      keys.forEach(function (k, n) { if (flags[n]) { out.push({ idx: n, desc: k.desc }); } });
      idxs.forEach(function (_, j) { out.push({ idx: keys.length + j, desc: false }); });
      return out;
    }
    rowKeys = sortByKeys(rowKeys, axisComparator(rowConstant, downIdx), function (rk) { return rowTuple[rk]; });
    colKeys = sortByKeys(colKeys, axisComparator(colConstant, acrossIdx), function (ck) { return colTuple[ck]; });

    var grid = newGrid();

    // One header row per "across" field. The row-header captions sit in the last
    // header row, directly above the values they label — the way the viz reads.
    acrossIdx.forEach(function (_, level) {
      var isLast = level === acrossIdx.length - 1;
      var cells = downIdx.map(function (i) { return isLast ? { v: headers[i] } : EMPTY; });
      colKeys.forEach(function (ck) { cells.push(colParts[ck][level] || EMPTY); });
      pushRow(grid, cells);

      // Merge runs of the same caption (BOY spanning its three years). Merges are
      // structure, not styling, so the community SheetJS build writes them fine.
      var start = 0;
      for (var c = 1; c <= colKeys.length; c++) {
        var here = c < colKeys.length ? text(colParts[colKeys[c]][level]) : null;
        var run = text(colParts[colKeys[start]][level]);
        if (here !== run) {
          if (c - start > 1) {
            grid.merges.push({
              s: { r: level, c: downIdx.length + start },
              e: { r: level, c: downIdx.length + c - 1 }
            });
          }
          start = c;
        }
      }
    });

    rowKeys.forEach(function (rk) {
      var cells = rowCells[rk].slice();
      colKeys.forEach(function (ck) { cells.push(body[rk + SEP + ck] || EMPTY); });
      pushRow(grid, cells);
    });

    return grid;
  }

  // Column widths from the widest thing in each column — the community SheetJS
  // build ignores fonts and fills but honours !cols, so this is the one bit of
  // presentation that actually survives the write.
  function columnWidths(grid) {
    var widths = [];
    grid.aoa.forEach(function (row) {
      row.forEach(function (v, c) {
        var len = String(v === null || v === undefined ? "" : v).length;
        if (!widths[c] || widths[c] < len) { widths[c] = len; }
      });
    });
    return widths.map(function (w) { return { wch: Math.min(Math.max((w || 4) + 2, 9), 46) }; });
  }

  function sheetFromGrid(grid) {
    var ws = XLSX.utils.aoa_to_sheet(grid.aoa);
    for (var r = 0; r < grid.fmt.length; r++) {
      for (var c = 0; c < grid.fmt[r].length; c++) {
        var z = grid.fmt[r][c];
        if (!z) { continue; }
        var cell = ws[XLSX.utils.encode_cell({ r: r, c: c })];
        if (cell && cell.t === "n") { cell.z = z; }
      }
    }
    if (grid.merges.length) { ws["!merges"] = grid.merges; }
    ws["!cols"] = columnWidths(grid);
    return ws;
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
        var data = await readSheet(ws);
        var cfg = getSheetConfig(name);
        var keep = keepIndices(data.headers, cfg.exclude);
        // Sort keys resolve against ALL headers, not just the kept ones — a sort
        // column is normally left out of the file and still obeyed.
        var sortKeys = sortKeyIndices(data.headers, cfg.sort);
        var grid = cfg.across.length
          ? crosstabGrid(data.headers, data.rows, keep, cfg.across, cfg.value, sortKeys)
          : flatGrid(data.headers, data.rows, keep, sortKeys);
        XLSX.utils.book_append_sheet(wb, sheetFromGrid(grid), safeSheetName(name, usedNames));
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

  // Best effort: which fields sit ONLY on the marks card's Tooltip shelf. Those
  // are the ones an author almost never wants in the spreadsheet, so they get
  // pre-unticked. getVisualSpecificationAsync's payload is host-supplied, so
  // everything here is duck-typed and wrapped — an older host or an unexpected
  // shape just means no suggestion, never a broken dialog.
  async function tooltipOnlyFields(worksheet) {
    var out = {};
    try {
      if (typeof worksheet.getVisualSpecificationAsync !== "function") { return out; }
      var spec = await worksheet.getVisualSpecificationAsync();
      var cards = (spec && (spec.marksSpecifications || spec.marksSpecification)) || [];
      var onTooltip = {}, elsewhere = {};
      cards.forEach(function (card) {
        var encodings = (card && (card.encodings || card.marksEncodings)) || [];
        encodings.forEach(function (enc) {
          if (!enc || !enc.field) { return; }
          var fieldName = enc.field.name || enc.field.fieldName;
          if (!fieldName) { return; }
          var bucket = String(enc.id).toLowerCase() === "tooltip" ? onTooltip : elsewhere;
          bucket[prettyHeader(fieldName).toLowerCase()] = true;
        });
      });
      // A field on Tooltip *and* on Text/Color is doing visible work — only the
      // tooltip-exclusive ones get suggested for removal.
      Object.keys(onTooltip).forEach(function (n) { if (!elsewhere[n]) { out[n] = true; } });
    } catch (e) { /* no suggestion */ }
    return out;
  }

  // Sort helpers exist to drive the viz, not to be read — suggest dropping them.
  function looksLikeSortField(header) {
    return /\bsort\b/i.test(header);
  }

  async function describeSheet(worksheet) {
    var headers = [];
    try {
      if (typeof worksheet.getSummaryColumnsInfoAsync === "function") {
        var cols = await worksheet.getSummaryColumnsInfoAsync();
        headers = uniqueHeaders((cols || []).map(function (c) { return c.fieldName; }));
      }
    } catch (e) {
      headers = [];
    }
    var tooltipOnly = await tooltipOnlyFields(worksheet);
    return {
      name: worksheet.name,
      columns: headers,
      suggestExclude: headers.filter(function (h) {
        return looksLikeSortField(h) || tooltipOnly[h.toLowerCase()];
      }),
      // Same fields, opposite purpose: kept out of the file, used to order it.
      suggestSort: headers.filter(looksLikeSortField)
    };
  }

  async function openConfigure() {
    var dashboard = tableau.extensions.dashboardContent.dashboard;
    var sheets = [];
    for (var i = 0; i < dashboard.worksheets.length; i++) {
      sheets.push(await describeSheet(dashboard.worksheets[i]));
    }

    var payload = JSON.stringify({
      sheets: sheets,
      current: {
        allowedSheets: getAllowedSheets(),
        sheetConfig: getJsonSetting(KEYS.sheetConfig, {}) || {},
        filenamePrefix: getSetting(KEYS.filenamePrefix, "CUSD_Export"),
        includeFooter: getSetting(KEYS.includeFooter, "true") === "true",
        footerText: getSetting(KEYS.footerText, DEFAULT_FOOTER),
        buttonLabel: getSetting(KEYS.buttonLabel, "Download to Excel")
      }
    });
    var url = new URL("./configure.html", window.location.href).href;

    return tableau.extensions.ui.displayDialogAsync(url, payload, { height: 660, width: 620 })
      .then(function (closePayload) {
        // The dialog returns the chosen config as JSON; the parent saves it.
        // "cancel" (or an empty payload) means the author backed out — leave settings as-is.
        if (!closePayload || closePayload === "cancel") { return; }
        var cfg = JSON.parse(closePayload);
        var s = tableau.extensions.settings;
        s.set(KEYS.allowedSheets, JSON.stringify(cfg.allowedSheets || []));
        s.set(KEYS.sheetConfig, JSON.stringify(cfg.sheetConfig || {}));
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
