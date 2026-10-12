/*
 * CUSD KPI Table — shared render engine (renderers.js)
 * ----------------------------------------------------
 * PURE, Tableau-independent. Loaded by BOTH the in-dashboard view (kpi-table.js)
 * and the Configure dialog (configure.js) so the live preview is byte-for-byte
 * what viewers see. No DOM/Tableau calls in here — just (config, rows) -> HTML.
 *
 * Data shape this engine consumes:
 *   rows : [ { <fieldName>: {v: <native>, f: <formatted string>}, ... }, ... ]
 *          one row per entity, or one row per entity-per-period when a time
 *          dimension (config.timeField) is set — the engine groups + focuses.
 *
 * The whole point of the config is encoded in RENDERER_META below: each renderer
 * declares exactly which inputs it needs (value field, max, target, comparison
 * basis, color rule, series). The Configure dialog reads that to show ONLY the
 * relevant controls — so adding a KPI column is answering 2-3 dropdowns.
 */
(function (global) {
  "use strict";

  var PALETTE = {
    ink: "#1f2a37", muted: "#6b7280", line: "#e5e7eb", line2: "#eef1f4",
    blue: "#2f6fb0", green: "#2e7d57", amber: "#c08a2d", red: "#c0432d", gray: "#7a7f87"
  };

  /* ---------------- value access + small helpers ---------------- */
  function cell(row, field) { return (row && field && row[field]) ? row[field] : null; }
  function val(row, field) { var c = cell(row, field); var n = c ? Number(c.v) : NaN; return isFinite(n) ? n : NaN; }
  function fval(row, field) { var c = cell(row, field); return c && c.f != null ? String(c.f) : ""; }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function num(x, d) { var n = Number(x); return isFinite(n) ? n : (d == null ? NaN : d); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function pt(cx, cy, r, deg) { var a = deg * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  // Compare two native period values (numbers, years, or strings) for sorting.
  function cmpVal(a, b) { var na = Number(a), nb = Number(b); if (isFinite(na) && isFinite(nb)) return na - nb; a = String(a); b = String(b); return a < b ? -1 : (a > b ? 1 : 0); }

  // Readable text color over a solid fill.
  function contrast(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return PALETTE.ink;
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? "#3a2a1f" : "#ffffff";
  }
  function tint(hex) { // light background for category pills
    return "#eef1f4";
  }

  /* ---------------- config resolution ---------------- */
  function resolveMax(col, row) {
    var m = (col.maxMode === "field") ? val(row, col.maxField) : num(col.maxConstant, NaN);
    return (isFinite(m) && m !== 0) ? m : 100;
  }
  function resolveTarget(col, row) {
    if (col.targetMode === "constant") return num(col.targetConstant, NaN);
    if (col.targetMode === "field") return val(row, col.targetField);
    return NaN;
  }
  function resolveCmp(col, row) {
    if (col.cmpMode === "constant") return num(col.cmpConstant, NaN);
    if (col.cmpMode === "field") return val(row, col.cmpField);
    return NaN;
  }
  function isGood(v, cmp, higherIsBetter) { return higherIsBetter === false ? (v <= cmp) : (v >= cmp); }

  // Single source of truth for "what color is this cell?"
  function resolveColor(col, row) {
    var mode = col.colorMode || "fixed";
    if (mode === "fixed") return col.fixedColor || PALETTE.blue;

    if (mode === "category") {
      var cv = fval(row, col.valueField);
      var map = col.categoryMap || [];
      for (var i = 0; i < map.length; i++) { if (String(map[i].value) === cv) return map[i].color; }
      return col.fixedColor || PALETTE.muted;
    }
    if (mode === "threshold") {
      var v = val(row, col.valueField);
      var bands = (col.thresholds || []).slice().sort(function (a, b) { return num(a.min) - num(b.min); });
      if (!bands.length) return col.fixedColor || PALETTE.muted;
      var chosen = bands[0].color;
      for (var j = 0; j < bands.length; j++) { if (v >= num(bands[j].min)) chosen = bands[j].color; }
      return chosen;
    }
    if (mode === "comparison") {
      var cmp = resolveCmp(col, row), vv = val(row, col.valueField), eps = num(col.eps, 0);
      if (!isFinite(cmp) || !isFinite(vv)) return col.neutralColor || PALETTE.muted;
      if (Math.abs(vv - cmp) <= eps) return col.neutralColor || PALETTE.gray;
      return isGood(vv, cmp, col.higherIsBetter) ? (col.goodColor || PALETTE.green) : (col.badColor || PALETTE.red);
    }
    return PALETTE.ink;
  }

  /* ---------------- SVG builders (the marks) ---------------- */
  var SPARK_ID = 0;

  function thumbSVG(up, color) {
    var rot = up ? "" : ' transform="rotate(180 12 12)"';
    return '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M2 21h2.5a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H2v11zM7.5 20a1 1 0 0 0 1 1h8.6a1.5 1.5 0 0 0 1.48-1.25l1.2-7A1.5 1.5 0 0 0 18.3 10H13V6.2A2.2 2.2 0 0 0 10.8 4c-.5 0-.85.32-1 .8L7.5 10.2V20z" fill="' + color + '"' + rot + '/></svg>';
  }
  function arrowSVG(dir) {
    var map = {
      up: [PALETTE.blue, "M12 3 L20 13 L15 13 L15 21 L9 21 L9 13 L4 13 Z"],
      down: [PALETTE.red, "M12 21 L4 11 L9 11 L9 3 L15 3 L15 11 L20 11 Z"],
      same: [PALETTE.gray, "M21 12 L11 4 L11 9 L3 9 L3 15 L11 15 L11 20 Z"]
    };
    var m = map[dir] || map.same;
    return '<svg viewBox="0 0 24 24" width="25" height="25"><path d="' + m[1] + '" fill="' + m[0] + '"/></svg>';
  }
  // Draws the full series; the focal point (focalIndex) gets the emphasized dot.
  function sparkSVG(values, color, focalIndex) {
    var w = 104, h = 30, pad = 3, bl = h - 1;
    var mn = Math.min.apply(null, values), mx = Math.max.apply(null, values), range = (mx - mn) || 1;
    var step = (w - 2 * pad) / (values.length - 1 || 1);
    var pts = values.map(function (v, i) { return [pad + i * step, h - pad - ((v - mn) / range) * (h - 2 * pad)]; });
    var line = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    var area = "M " + pts[0][0].toFixed(1) + " " + bl + " " + pts.map(function (p) { return "L " + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ") + " L " + pts[pts.length - 1][0].toFixed(1) + " " + bl + " Z";
    var fi = (focalIndex == null || focalIndex < 0 || focalIndex >= pts.length) ? pts.length - 1 : focalIndex;
    var dot = pts[fi], id = "spk" + (++SPARK_ID);
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.32"/>' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.03"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#' + id + ')" stroke="none"/>' +
      '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + dot[0].toFixed(1) + '" cy="' + dot[1].toFixed(1) + '" r="3" fill="' + color + '" stroke="#ffffff" stroke-width="1"/></svg>';
  }
  function pieSVG(pct, max) {
    var frac = clamp01(pct / (max || 100)), cx = 16, cy = 16, r = 15;
    var s = '<circle cx="16" cy="16" r="15" fill="#d4d7db"/>';
    if (frac >= 0.999) { s += '<circle cx="16" cy="16" r="15" fill="' + PALETTE.red + '"/>'; }
    else if (frac > 0) {
      var p0 = pt(cx, cy, r, -90), p1 = pt(cx, cy, r, -90 + 360 * frac), lg = frac > 0.5 ? 1 : 0;
      s += '<path d="M16 16 L' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) + ' A15 15 0 ' + lg + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2) + ' Z" fill="' + PALETTE.red + '"/>';
    }
    s += '<circle cx="16" cy="16" r="15" fill="none" stroke="#ffffff" stroke-width="1.1"/>';
    return '<svg viewBox="0 0 32 32" width="36" height="36" style="filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.18))">' + s + '</svg>';
  }
  function donutSVG(pct, max, color) {
    var frac = clamp01(pct / (max || 100)), r = 13, c = 2 * Math.PI * r, len = frac * c;
    return '<svg viewBox="0 0 32 32" width="36" height="36">' +
      '<circle cx="16" cy="16" r="' + r + '" fill="none" stroke="#e3e6ea" stroke-width="5.5"/>' +
      '<circle cx="16" cy="16" r="' + r + '" fill="none" stroke="' + (color || PALETTE.blue) + '" stroke-width="5.5" stroke-linecap="round" stroke-dasharray="' + len.toFixed(2) + ' ' + (c - len).toFixed(2) + '" transform="rotate(-90 16 16)"/></svg>';
  }

  /* ---------------- cell renderers (config, row, ctx) -> HTML ---------------- */
  function label(row, col) { return esc(fval(row, col.valueField)) + (col.suffix ? esc(col.suffix) : ""); }

  var RENDERERS = {
    number: function (col, row) { return '<span class="num">' + esc(col.prefix || "") + label(row, col) + '</span>'; },
    text: function (col, row) { return '<span class="txt" style="color:' + resolveColor(col, row) + '">' + esc(fval(row, col.valueField)) + '</span>'; },
    twoLine: function (col, row) { return '<div class="twoline"><div class="a">' + esc(fval(row, col.valueField)) + '</div><div class="b">' + esc(fval(row, col.subField)) + '</div></div>'; },
    numberSub: function (col, row) { return '<div class="twoline"><div class="a">' + esc(fval(row, col.valueField)) + '</div><div class="b">(' + esc(fval(row, col.subField)) + ')</div></div>'; },
    bar: function (col, row) {
      var w = clamp01(val(row, col.valueField) / resolveMax(col, row)) * 100;
      return '<div class="barwrap"><div class="bar2"><i style="width:' + w + '%;background:' + resolveColor(col, row) + '"></i></div><span class="barval">' + label(row, col) + '</span></div>';
    },
    bullet: function (col, row) {
      var max = resolveMax(col, row), tgt = resolveTarget(col, row);
      var w = clamp01(val(row, col.valueField) / max) * 100, tx = clamp01(tgt / max) * 100;
      var tick = isFinite(tgt) ? '<span style="position:absolute;left:' + tx + '%;top:-2px;bottom:-2px;width:2px;background:' + PALETTE.ink + '"></span>' : "";
      return '<div class="barwrap"><div class="bar2"><i style="width:' + w + '%;background:' + resolveColor(col, row) + '"></i>' + tick + '</div><span class="barval">' + label(row, col) + '</span></div>';
    },
    rateOverBar: function (col, row) {
      var w = clamp01(val(row, col.valueField) / resolveMax(col, row)) * 100;
      return '<div class="rate"><span class="n">' + label(row, col) + '</span><div class="ratebar"><i style="width:' + w + '%;background:' + resolveColor(col, row) + '"></i></div></div>';
    },
    circleKPI: function (col, row) {
      var bg = resolveColor(col, row), fg = contrast(bg);
      return '<div class="center"><div class="kpic" style="background:' + bg + ';color:' + fg + '">' + label(row, col) + '</div></div>';
    },
    pie: function (col, row) {
      return '<div class="inline" style="gap:9px">' + pieSVG(val(row, col.valueField), resolveMax(col, row)) + '<span class="num">' + label(row, col) + '</span></div>';
    },
    donut: function (col, row) {
      return '<div class="inline" style="gap:9px">' + donutSVG(val(row, col.valueField), resolveMax(col, row), col.fixedColor || PALETTE.blue) + '<span class="num">' + label(row, col) + '</span></div>';
    },
    arrow: function (col, row) {
      var cmp = resolveCmp(col, row), v = val(row, col.valueField), eps = num(col.eps, 0);
      var dir = !isFinite(cmp) ? "same" : (v > cmp + eps ? "up" : (v < cmp - eps ? "down" : "same"));
      return '<div class="inline" style="min-width:92px">' + arrowSVG(dir) + '<span class="num">' + label(row, col) + '</span></div>';
    },
    thumb: function (col, row) {
      var v = val(row, col.valueField), cmp = resolveCmp(col, row), up, color;
      if (col.cmpMode === "none" || !col.cmpMode) {           // binary flag mode (e.g. chronic = thumb down)
        var flagged = !!(cell(row, col.valueField) && (cell(row, col.valueField).v === true || cell(row, col.valueField).v === 1 || /^(true|yes|y|1)$/i.test(fval(row, col.valueField))));
        up = !flagged; color = flagged ? PALETTE.red : PALETTE.blue;
        return '<div class="center">' + thumbSVG(up, color) + '</div>';
      }
      var good = isGood(v, cmp, col.higherIsBetter);            // vs goal mode
      up = good; color = good ? PALETTE.green : PALETTE.red;
      return '<div class="inline" style="min-width:92px">' + thumbSVG(up, color) + '<span class="num">' + label(row, col) + '</span></div>';
    },
    ragPill: function (col, row) {
      var c = resolveColor(col, row);
      if ((col.colorMode || "fixed") === "category" || col.colorMode === "fixed") {
        return '<span class="pill" style="background:' + tint(c) + ';color:' + c + '">' + esc(fval(row, col.valueField)) + '</span>';
      }
      return '<span class="pill" style="background:' + c + ';color:' + contrast(c) + '">' + label(row, col) + '</span>';
    },
    // Trend for col.valueField across the time dimension. Two modes (ctx.sparkClip):
    //   clip  → series ends at the focal year (history "as of" that year)
    //   full  → whole series always drawn; the focal year just gets the marker+label
    // Either way the dot + label sit on the selected (focal) year.
    sparkline: function (col, row, ctx) {
      var pers = (ctx.entity && ctx.entity.periods) ? ctx.entity.periods : [];
      var pairs = [];
      pers.forEach(function (p) {
        if (ctx.sparkClip && ctx.focalV != null && cmpVal(p.v, ctx.focalV) > 0) return; // clip future years
        var n = val(p.row, col.valueField); if (isFinite(n)) pairs.push({ v: n, f: fval(p.row, col.valueField), pv: p.v });
      });
      if (pairs.length < 2) return '<span class="muted">—</span>';
      var values = pairs.map(function (x) { return x.v; });
      var fi = pairs.length - 1; // clip => focal is the last point; full => find it
      if (!ctx.sparkClip && ctx.focalV != null) { for (var i = 0; i < pairs.length; i++) { if (cmpVal(pairs[i].pv, ctx.focalV) === 0) { fi = i; break; } } }
      var up = values[values.length - 1] >= values[0], color = up ? PALETTE.green : PALETTE.red;
      return '<div class="sparkwrap">' + sparkSVG(values, color, fi) + '<span class="sparkend" style="color:' + color + '">' + esc(pairs[fi].f) + '</span></div>';
    }
  };

  /* ---------------- declarative spec the Configure dialog reads ----------------
     needs: required inputs the dialog must collect for this renderer
     opts:  optional inputs the dialog may offer
     control keys: value, sub, max, target, compare, color, series, suffix, higherIsBetter */
  var RENDERER_META = {
    number:      { label: "Number",            needs: ["value"],                 opts: ["suffix"] },
    text:        { label: "Text (colored)",    needs: ["value"],                 opts: ["color"] },
    numberSub:   { label: "Number + subtotal", needs: ["value", "sub"],          opts: [] },
    bar:         { label: "Bar → max",         needs: ["value", "max"],          opts: ["color", "suffix"] },
    bullet:      { label: "Bar vs target",     needs: ["value", "max", "target"],opts: ["color", "suffix"] },
    rateOverBar: { label: "Number over bar",   needs: ["value", "max"],          opts: ["color", "suffix"] },
    circleKPI:   { label: "KPI circle",        needs: ["value"],                 opts: ["color"] },
    pie:         { label: "Pie (% of max)",    needs: ["value", "max"],          opts: [] },
    donut:       { label: "Donut (% of max)",  needs: ["value", "max"],          opts: ["fixedColor"] },
    arrow:       { label: "Trend arrow",       needs: ["value", "compare"],      opts: [] },
    thumb:       { label: "Thumb up/down",     needs: ["value"],                 opts: ["compare", "higherIsBetter"] },
    ragPill:     { label: "Status pill",       needs: ["value"],                 opts: ["color"] },
    sparkline:   { label: "Sparkline (over time)", needs: ["value"],             opts: [] }
  };

  /* ---------------- table assembly ---------------- */
  function renderCell(col, row, ctx) {
    var fn = RENDERERS[col.renderer];
    try { return fn ? fn(col, row, ctx) : esc(fval(row, col.valueField)); }
    catch (e) { return '<span class="muted">—</span>'; }
  }

  // Distinct, sorted periods present in the data for the configured time dimension.
  function computePeriods(config, rows) {
    if (!config.timeField) return [];
    var seen = {}, list = [];
    (rows || []).forEach(function (r) {
      var c = r[config.timeField]; if (!c) return;
      var f = String(c.f); if (seen[f]) return; seen[f] = true; list.push({ f: f, v: c.v });
    });
    list.sort(function (a, b) { return cmpVal(a.v, b.v); });
    return list;
  }

  // Group rows by row identity; pick each entity's focal-period row and keep its
  // full period series (for sparklines). No time dimension => one row per entity.
  function groupAndFocus(config, rows) {
    var periods = computePeriods(config, rows);
    var focalF = (config.focalPeriod && periods.some(function (p) { return p.f === config.focalPeriod; }))
      ? config.focalPeriod : (periods.length ? periods[periods.length - 1].f : null);
    var focalV = null; periods.forEach(function (p) { if (p.f === focalF) focalV = p.v; });

    var byKey = {}, order = [];
    (rows || []).forEach(function (r) {
      var key = fval(r, config.rowField);
      if (!byKey[key]) { byKey[key] = []; order.push(key); }
      byKey[key].push(r);
    });
    var entities = order.map(function (k) {
      var rs = byKey[k], focalRow = null, periodsForE;
      if (!config.timeField) {
        focalRow = rs[0]; periodsForE = [{ v: 0, f: "", row: rs[0] }];
      } else {
        periodsForE = rs.map(function (r) { var c = r[config.timeField]; return { v: c ? c.v : null, f: c ? String(c.f) : "", row: r }; })
          .sort(function (a, b) { return cmpVal(a.v, b.v); });
        var le = null;
        periodsForE.forEach(function (p) {
          if (p.f === focalF) focalRow = p.row;
          if (focalV == null || cmpVal(p.v, focalV) <= 0) le = p.row;
        });
        if (!focalRow) focalRow = le || (periodsForE.length ? periodsForE[periodsForE.length - 1].row : null);
      }
      return { key: k, focalRow: focalRow, periods: periodsForE };
    });
    return { periods: periods, focalF: focalF, focalV: focalV, entities: entities };
  }

  // Returns the <thead>+<tbody> innerHTML for a <table>. Caller owns the element + class.
  // config.focalPeriod (formatted) selects the focal year; default = latest present.
  function renderTableInner(config, rows) {
    var g = groupAndFocus(config, rows);
    var cols = config.columns || [];
    var html = "<thead><tr>";
    html += '<th class="col-head" style="text-align:left">' + esc(config.rowHeader || config.rowField || "") + "</th>";
    cols.forEach(function (c) { html += "<th>" + esc(c.header || c.valueField || "") + (c.hint ? '<span class="hint">' + esc(c.hint) + "</span>" : "") + "</th>"; });
    html += "</tr></thead><tbody>";
    g.entities.forEach(function (e) {
      var ctx = { entity: e, focalV: g.focalV, sparkClip: config.sparkClip };
      var idRow = e.focalRow || (e.periods[0] && e.periods[0].row) || {};
      var idCol = { renderer: config.rowSubField ? "twoLine" : "text", valueField: config.rowField, subField: config.rowSubField, colorMode: "fixed", fixedColor: PALETTE.ink };
      html += '<tr><td class="col-head">' + renderCell(idCol, idRow, ctx) + "</td>";
      cols.forEach(function (c) { html += "<td>" + renderCell(c, e.focalRow, ctx) + "</td>"; });
      html += "</tr>";
    });
    return html + "</tbody>";
  }

  global.KPI = {
    PALETTE: PALETTE, val: val, fval: fval, esc: esc,
    RENDERERS: RENDERERS, RENDERER_META: RENDERER_META,
    resolveColor: resolveColor, renderCell: renderCell, renderTableInner: renderTableInner,
    computePeriods: computePeriods
  };
})(typeof window !== "undefined" ? window : this);
