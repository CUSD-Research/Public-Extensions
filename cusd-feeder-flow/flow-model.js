/*
 * CUSD Feeder Flow — model, layout and SVG renderer.
 * --------------------------------------------------
 * Everything in this file is a pure function of its inputs: no DOM, no Tableau,
 * no network. feeder-flow.js feeds it rows read from a worksheet; mockup.html
 * feeds it synthetic rows; tests/test_feeder_flow_extension.js loads it in a
 * sandbox and asserts on the numbers. One copy of the logic, three callers.
 *
 * What it draws, and why it is shaped this way:
 *
 *   The question is "where did this school's students go next year". The origin
 *   is one node, and in every cohort most students stay -- 65% to 90%. A normal
 *   Sankey spends that share of the canvas on one ribbon that says "most stayed",
 *   and squeezes the students who actually moved into slivers too thin to label.
 *
 *   So the stayers become a headline strip -- one number and a proportional bar --
 *   and the flow below it draws only the students who did not stay, at full
 *   height. Every node carries its count and its share of the WHOLE cohort, so
 *   the numbers in the flow add up with the headline, not with each other.
 *   Right-hand labels sit in a gutter with leader lines, so a destination of two
 *   students still gets a readable line. Nodes only collapse into "Other" when
 *   the labels physically cannot fit the height available.
 *
 * Nothing here is tied to the feeder question. The four feeder categories are a
 * PRESET (their order, short labels and colours); any other category the rows
 * carry ranks after the configured order, largest first, and takes a palette
 * colour keyed to its name. The nouns ("students", "schools") are options. A
 * question shaped "where did X go" -- graduates, staff, program exits -- needs
 * only the four columns: origin, category, destination, count.
 */
(function (global) {
  "use strict";

  var CATEGORY_ORDER = [
    "Moved to Another CUSD School",
    "Moved from Another CUSD School",
    "Left CUSD",
    "New to CUSD",
    "Graduated or Completed"
  ];
  var CATEGORY_SHORT = {
    "Stayed at Same School": "Stayed",
    "Moved to Another CUSD School": "Moved within CUSD",
    "Moved from Another CUSD School": "Moved within CUSD",
    "Left CUSD": "Left CUSD",
    "New to CUSD": "New to CUSD",
    "Graduated or Completed": "Graduated"
  };
  // Tableau 10, the same colours the workbook's category legend already uses.
  var CATEGORY_COLOR = {
    "Stayed at Same School": "#76b7b2",
    "Moved to Another CUSD School": "#e15759",
    "Moved from Another CUSD School": "#e15759",   // the inbound twin: moving within CUSD is red in both directions
    "Left CUSD": "#f28e2b",
    "New to CUSD": "#f28e2b",                      // the inbound twin of Left CUSD: crossing the district boundary is orange both ways
    "Graduated or Completed": "#4e79a7"
  };
  // Tableau 10. A category with no configured colour draws from here, keyed by a hash of its
  // name so it keeps its colour across filter changes and sessions; collisions among the
  // categories present are resolved in rank order, so a given set of categories always
  // colours the same way.
  var PALETTE = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"];

  var DEFAULTS = {
    stayedCategory: "Stayed at Same School",
    includeStayed: false,
    otherLabel: "Other",
    nodeWidth: 14,
    nodePad: 6,
    labelHeight: 17,         // one-line label pitch (right-hand column)
    twoLineHeight: 30,       // two-line label pitch (origin and category columns), while they fit
    leftGutter: 150,
    rightGutter: 240,
    middleFraction: 0.42,
    headlineHeight: 66,
    footerHeight: 20,
    margin: 10,
    minRibbonLabel: 14,
    maxDestinations: 0,      // 0 = show every destination the height allows; N = keep the N largest per category, rest into Other
    charWidth: 6.6,          // estimated px per character at 12px, for sizing the label gutters
    title: "",
    unit: "students",        // the thing being counted, as it reads in the headline and footer
    originNoun: "schools",   // plural noun for the origins, used when several are drawn
    notStayedPhrase: "did not stay",   // the words after an origin's share and in the ribbon tooltip and footer; an inbound flow reads "came from elsewhere"
    mirror: false,           // true draws the flow right to left: the origin on the right, its sources flowing in from the left (the feeder viz's inbound direction)
    categoryOrder: CATEGORY_ORDER,   // top-to-bottom order of the categories; unlisted ones follow, largest first
    categoryShort: CATEGORY_SHORT,   // shorter labels for the headline and the middle column
    categoryColor: CATEGORY_COLOR    // colour per category; unlisted ones draw from PALETTE
  };

  function assign(base, extra) {
    var out = {}, k;
    for (k in base) { if (Object.prototype.hasOwnProperty.call(base, k)) { out[k] = base[k]; } }
    for (k in extra || {}) { if (Object.prototype.hasOwnProperty.call(extra, k) && extra[k] !== undefined) { out[k] = extra[k]; } }
    return out;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function clip(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s; }

  function fmtInt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function fmtPct(p) {
    if (!isFinite(p)) { return "0%"; }
    var v = p * 100;
    if (v > 0 && v < 0.05) { return "<0.1%"; }        // one student in a big cohort is not "0.0%"
    return (v >= 10 || v === 0 ? v.toFixed(0) : v.toFixed(1)) + "%";
  }

  // Rank of a category: the stayed category first, then the configured order, then everything
  // else largest first. The "everything else" part needs the sizes, so buildModel computes the
  // full map once (opts.rankOf) and every later sort reads it.
  function categoryRank(cat, opts) {
    if (cat === opts.stayedCategory) { return -1; }
    if (opts.rankOf && Object.prototype.hasOwnProperty.call(opts.rankOf, cat)) { return opts.rankOf[cat]; }
    var order = opts.categoryOrder || [], i = order.indexOf(cat);
    return i < 0 ? order.length : i;
  }
  function shortOf(cat, opts) { return (opts.categoryShort && opts.categoryShort[cat]) || cat; }
  // A fold node's label carries how many destinations it absorbed: "3 others" for the default
  // label, "<label> (3)" for a configured one. Kent (2026-09-11): the numbers sit in parentheses
  // after every name, so the default fold cannot also end in a parenthesis.
  function foldName(n, opts) {
    if (n.label !== opts.otherLabel || !(n.members > 1)) { return n.label; }
    return opts.otherLabel === "Other" ? n.members + " others" : n.label + " (" + n.members + ")";
  }

  function hashStr(str) { var h = 5381, i; for (i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) | 0; } return Math.abs(h); }

  // One colour per category present: the configured colour where there is one (the feeder preset
  // plus anything passed in), otherwise a palette colour keyed by the name's hash, skipping
  // colours already taken. Walks the categories in rank order, so the result is stable for a
  // given set of categories.
  function resolveColors(catsInRank, opts) {
    var pref = assign(CATEGORY_COLOR, opts.categoryColor), out = {}, taken = {}, i, j, c;
    for (i = 0; i < catsInRank.length; i++) { c = catsInRank[i]; if (pref[c]) { out[c] = pref[c]; taken[pref[c]] = true; } }
    for (i = 0; i < catsInRank.length; i++) {
      c = catsInRank[i];
      if (out[c]) { continue; }
      var start = hashStr(c) % PALETTE.length, pick = null;
      for (j = 0; j < PALETTE.length; j++) { var col = PALETTE[(start + j) % PALETTE.length]; if (!taken[col]) { pick = col; break; } }
      out[c] = pick || PALETTE[start];
      taken[out[c]] = true;
    }
    return out;
  }
  function colorOf(cat, opts) {
    if (opts.colorOf && opts.colorOf[cat]) { return opts.colorOf[cat]; }
    var pref = assign(CATEGORY_COLOR, opts.categoryColor);
    return pref[cat] || "#9aa0a6";
  }

  // One origin is titled by its name. Several are titled by their count: a flow with three
  // origins has no single school to name, and the first one's name would be wrong for the
  // other two.
  function originTitle(origins, noun) {
    if (!origins || !origins.length) { return ""; }
    return origins.length === 1 ? origins[0].label : fmtInt(origins.length) + " " + (noun || "schools");
  }

  // ---------------------------------------------------------------------------
  // buildModel: rows -> headline + columns + links, before any pixels exist.
  // rows: [{ origin, category, destination, count }]
  // ---------------------------------------------------------------------------
  function buildModel(rows, options) {
    var opts = assign(DEFAULTS, options);
    var total = 0, stayed = 0, byCat = {}, i, r;

    // Normalise once: a blank category is "(blank)" rather than an empty label, a blank
    // destination falls back to its category (a node still needs a name), and a count that
    // is not a number is zero, which the loops below then skip.
    rows = (rows || []).map(function (row) {
      var cat = String(row.category == null ? "" : row.category).trim() || "(blank)";
      var dest = String(row.destination == null ? "" : row.destination).trim() || cat;
      var origin = String(row.origin == null ? "" : row.origin).trim() || "(blank)";
      return { origin: origin, category: cat, destination: dest, count: Number(row.count) || 0 };
    });

    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      var c = Number(r.count) || 0;
      if (c <= 0) { continue; }
      total += c;
      byCat[r.category] = (byCat[r.category] || 0) + c;
      if (r.category === opts.stayedCategory) { stayed += c; }
    }

    // Rank every category present: configured order first, the rest largest first (ties by
    // name). Then colours, in that rank order. Both maps ride on opts, which layout copies.
    var order = opts.categoryOrder || [], rankOf = {}, extras = [];
    Object.keys(byCat).forEach(function (cat) {
      var k = order.indexOf(cat);
      if (k >= 0) { rankOf[cat] = k; } else if (cat !== opts.stayedCategory) { extras.push(cat); }
    });
    extras.sort(function (a, b) { return (byCat[b] - byCat[a]) || (a < b ? -1 : a > b ? 1 : 0); });
    extras.forEach(function (cat, k) { rankOf[cat] = order.length + k; });
    opts.rankOf = rankOf;
    var cats = Object.keys(byCat).sort(function (a, b) { return categoryRank(a, opts) - categoryRank(b, opts); });
    opts.colorOf = resolveColors(cats, opts);

    var headline = cats.map(function (cat) {
      return { category: cat, short: shortOf(cat, opts), count: byCat[cat], pct: total ? byCat[cat] / total : 0, color: colorOf(cat, opts) };
    });

    var flowRows = rows.filter(function (row) {
      return (Number(row.count) || 0) > 0 && (opts.includeStayed || row.category !== opts.stayedCategory);
    });
    var flowTotal = 0;
    for (i = 0; i < flowRows.length; i++) { flowTotal += Number(flowRows[i].count) || 0; }

    // Column 0: origins. Column 1: categories. Column 2: destinations, keyed by
    // category + name so an exit reason and a school can never merge.
    var origins = {}, categories = {}, dests = {}, l01 = {}, l12 = {};
    for (i = 0; i < flowRows.length; i++) {
      r = flowRows[i];
      var n = Number(r.count) || 0;
      var oKey = "o:" + r.origin, cKey = "c:" + r.category, dKey = "d:" + r.category + "|" + r.destination;
      origins[oKey] = origins[oKey] || { id: oKey, col: 0, label: r.origin, category: null, size: 0 };
      categories[cKey] = categories[cKey] || { id: cKey, col: 1, label: r.category, short: shortOf(r.category, opts), category: r.category, size: 0 };
      dests[dKey] = dests[dKey] || { id: dKey, col: 2, label: r.destination, category: r.category, size: 0, members: 1 };
      origins[oKey].size += n; categories[cKey].size += n; dests[dKey].size += n;
      var k01 = oKey + "->" + cKey, k12 = cKey + "->" + dKey;
      l01[k01] = l01[k01] || { source: oKey, target: cKey, category: r.category, value: 0 };
      l12[k12] = l12[k12] || { source: cKey, target: dKey, category: r.category, value: 0 };
      l01[k01].value += n; l12[k12].value += n;
    }

    function values(o) { return Object.keys(o).map(function (k) { return o[k]; }); }
    var col0 = values(origins).sort(function (a, b) { return b.size - a.size; });
    var col1 = values(categories).sort(function (a, b) { return categoryRank(a.category, opts) - categoryRank(b.category, opts); });
    var col2 = values(dests).sort(function (a, b) {
      var ra = categoryRank(a.category, opts), rb = categoryRank(b.category, opts);
      if (ra !== rb) { return ra - rb; }                       // grouped under their category, same order as column 1
      var oa = a.label === opts.otherLabel ? 1 : 0, ob = b.label === opts.otherLabel ? 1 : 0;
      if (oa !== ob) { return oa - ob; }                       // Other pinned to the bottom of its group
      if (b.size !== a.size) { return b.size - a.size; }       // then by size
      return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
    });

    var links = values(l01).concat(values(l12));

    // Optional author cap: keep the N largest destinations in each category, fold the rest into Other.
    if (opts.maxDestinations > 0) {
      var kept = [], perCat = {}, i2;
      for (i2 = 0; i2 < col2.length; i2++) {
        var d2 = col2[i2], cnt = perCat[d2.category] || 0;
        if (d2.label === opts.otherLabel || cnt < opts.maxDestinations) { kept.push(d2); perCat[d2.category] = cnt + 1; continue; }
        var oid = "d:" + d2.category + "|" + opts.otherLabel, oth = null, j2;
        for (j2 = 0; j2 < kept.length; j2++) { if (kept[j2].id === oid) { oth = kept[j2]; break; } }
        if (!oth) { oth = { id: oid, col: 2, label: opts.otherLabel, category: d2.category, size: 0, members: 0 }; kept.push(oth); }
        oth.size += d2.size; oth.members += d2.members || 1;
        var lnk = null, ex = null;
        for (j2 = 0; j2 < links.length; j2++) {
          if (links[j2].target === d2.id) { lnk = links[j2]; }
          if (links[j2].target === oid) { ex = links[j2]; }
        }
        if (lnk && ex) { ex.value += lnk.value; links.splice(links.indexOf(lnk), 1); }
        else if (lnk) { lnk.target = oid; }
      }
      col2 = kept.sort(function (a, b) {
        var ra = categoryRank(a.category, opts), rb = categoryRank(b.category, opts);
        if (ra !== rb) { return ra - rb; }
        var oa = a.label === opts.otherLabel ? 1 : 0, ob = b.label === opts.otherLabel ? 1 : 0;
        if (oa !== ob) { return oa - ob; }
        return b.size - a.size;
      });
    }

    var all = col0.concat(col1, col2);
    for (i = 0; i < all.length; i++) { all[i].pct = total ? all[i].size / total : 0; all[i].pctOfFlow = flowTotal ? all[i].size / flowTotal : 0; }
    for (i = 0; i < links.length; i++) { links[i].pct = total ? links[i].value / total : 0; links[i].pctOfFlow = flowTotal ? links[i].value / flowTotal : 0; }

    return {
      total: total, stayed: stayed, stayedPct: total ? stayed / total : 0,
      flowTotal: flowTotal, headline: headline,
      columns: [col0, col1, col2], links: links, opts: opts
    };
  }

  // ---------------------------------------------------------------------------
  // collapse: fold the smallest destinations into their group's "Other" until the
  // right-hand labels fit the height. Returns a NEW model; never mutates.
  // ---------------------------------------------------------------------------
  function collapseToFit(model, availableHeight) {
    var opts = model.opts, labelH = opts.labelHeight;
    var col2 = model.columns[2].map(function (n) { return assign(n, {}); });
    var links = model.links.map(function (l) { return assign(l, {}); });

    function fits() { return col2.length * labelH <= availableHeight; }

    while (!fits() && col2.length > 1) {
      // Smallest non-Other node, ties broken toward the group with the most members.
      var victim = null, vi = -1, i;
      for (i = 0; i < col2.length; i++) {
        var n = col2[i];
        if (n.label === opts.otherLabel) { continue; }
        if (!victim || n.size < victim.size) { victim = n; vi = i; }
      }
      if (!victim) { break; }
      var otherId = "d:" + victim.category + "|" + opts.otherLabel;
      var other = null;
      for (i = 0; i < col2.length; i++) { if (col2[i].id === otherId) { other = col2[i]; break; } }
      if (!other) {
        other = { id: otherId, col: 2, label: opts.otherLabel, category: victim.category, size: 0, members: 0, pct: 0, pctOfFlow: 0 };
        col2.push(other);
      }
      other.size += victim.size; other.members += victim.members || 1;
      other.pct = model.total ? other.size / model.total : 0;
      other.pctOfFlow = model.flowTotal ? other.size / model.flowTotal : 0;
      col2.splice(vi, 1);

      // Re-point the victim's incoming link at Other, merging if one already exists.
      var moved = null, existing = null;
      for (i = 0; i < links.length; i++) {
        if (links[i].target === victim.id) { moved = links[i]; }
        if (links[i].target === otherId && links[i].source === "c:" + victim.category) { existing = links[i]; }
      }
      if (moved && existing) {
        existing.value += moved.value; existing.pct = model.total ? existing.value / model.total : 0;
        existing.pctOfFlow = model.flowTotal ? existing.value / model.flowTotal : 0;
        links.splice(links.indexOf(moved), 1);
      } else if (moved) {
        moved.target = otherId;
      }

      col2.sort(function (a, b) {
        var ra = categoryRank(a.category, opts), rb = categoryRank(b.category, opts);
        if (ra !== rb) { return ra - rb; }
        var oa = a.label === opts.otherLabel ? 1 : 0, ob = b.label === opts.otherLabel ? 1 : 0;
        if (oa !== ob) { return oa - ob; }
        return b.size - a.size;
      });
    }
    return assign(model, { columns: [model.columns[0], model.columns[1], col2], links: links });
  }

  // ---------------------------------------------------------------------------
  // layout: model + canvas size -> positioned nodes, ribbons and labels.
  // ---------------------------------------------------------------------------
  function layout(inputModel, width, height, options) {
    var opts = assign(inputModel.opts, options);
    var m = opts.margin;
    var top = m + opts.headlineHeight;
    var flowH = height - top - opts.footerHeight - m;
    if (flowH < 40) { flowH = 40; }

    var model = collapseToFit(inputModel, flowH);
    var cols = model.columns, i, j, c;

    // Gutters grow to fit the longest label (estimated), within a cap, unless the caller fixed them.
    // Ceil, never round: rounding a fractional width down made the character allowance one short
    // of the longest label, which then clipped the very label the gutter was sized for. The
    // right-hand measure includes the "(n)" a fold label carries, for the same reason.
    function longest(arr, f) { var mx = 0; for (var q = 0; q < arr.length; q++) { var L = f(arr[q]).length; if (L > mx) { mx = L; } } return mx; }
    function rightName(n) { return foldName(n, opts); }
    // The left gutter holds two lines per origin: the name (bold, wider glyphs) and the numbers
    // line ("675 · 29% did not stay"). The numbers line is the longer one whenever the school
    // name is short -- PERRY HIGH rendered as "5 · 29% did not stay" on the live dashboard
    // (2026-09-11) because only the name was measured. Measure both, in the layout the column
    // will actually use (two lines, or one when the origins do not fit at two).
    var hasStayed = model.stayed > 0 && !opts.includeStayed;
    var phrase = opts.notStayedPhrase || "did not stay";
    function originNums(n) { return "(" + fmtInt(n.size) + " · " + fmtPct(n.pct) + (hasStayed ? " " + phrase : "") + ")"; }
    var twoLine0 = cols[0].length * opts.twoLineHeight <= flowH;
    if (options == null || options.leftGutter === undefined) {
      var lw = 0, q0;
      for (q0 = 0; q0 < cols[0].length; q0++) {
        var nameW = cols[0][q0].label.length * opts.charWidth * 1.18, numsW = originNums(cols[0][q0]).length * opts.charWidth;
        var w0 = twoLine0 ? Math.max(nameW, numsW) : nameW + 2 * opts.charWidth + numsW;
        if (w0 > lw) { lw = w0; }
      }
      opts.leftGutter = Math.max(90, Math.min(Math.round(width * 0.24), Math.ceil(lw + 26)));
    }
    if (options == null || options.rightGutter === undefined) {
      var rw = longest(cols[2], function (n) { return rightName(n) + " (" + fmtInt(n.size) + " · " + fmtPct(n.pct) + ")"; }) * opts.charWidth + 22;
      opts.rightGutter = Math.max(120, Math.min(Math.round(width * 0.36), Math.ceil(rw)));
    }
    opts.rightChars = Math.max(8, Math.floor((opts.rightGutter - 22) / opts.charWidth));
    opts.leftChars = Math.max(8, Math.floor((opts.leftGutter - 26) / (opts.charWidth * 1.18)));
    opts.leftNumChars = Math.max(6, Math.floor((opts.leftGutter - 26) / opts.charWidth));   // the numbers line, regular weight

    // One scale for every column, so a ribbon's width means the same thing everywhere.
    var F = model.flowTotal || 1, scale = Infinity;
    for (c = 0; c < 3; c++) {
      var n = cols[c].length;
      if (!n) { continue; }
      var s = (flowH - opts.nodePad * (n - 1)) / F;
      if (s < scale) { scale = s; }
    }
    if (!isFinite(scale) || scale <= 0) { scale = 0; }

    // leftGutter is sized for the origin labels and rightGutter for the destination labels, whichever
    // side each column lands on. Mirrored, the origin column sits on the right and the destinations
    // flow in from the left, so the physical gutters swap and the columns count down from the right.
    var mirror = !!opts.mirror;
    var physLeft = mirror ? opts.rightGutter : opts.leftGutter, physRight = mirror ? opts.leftGutter : opts.rightGutter;
    var innerW = width - physLeft - physRight - 2 * m;
    var x0 = m + physLeft;
    var xs = mirror
      ? [x0 + innerW - opts.nodeWidth, x0 + innerW - Math.round(innerW * opts.middleFraction) - opts.nodeWidth, x0]
      : [x0, x0 + Math.round(innerW * opts.middleFraction), x0 + innerW - opts.nodeWidth];

    // Stack each column, centred on the flow band.
    var nodes = {};
    for (c = 0; c < 3; c++) {
      var stackH = 0;
      for (i = 0; i < cols[c].length; i++) { stackH += cols[c][i].size * scale; }
      stackH += opts.nodePad * Math.max(0, cols[c].length - 1);
      var y = top + (flowH - stackH) / 2;
      for (i = 0; i < cols[c].length; i++) {
        var node = assign(cols[c][i], { x: xs[c], y: y, h: cols[c][i].size * scale, w: opts.nodeWidth, sourceOffset: 0, targetOffset: 0 });
        node.color = c === 0 ? "#5f6b7a" : colorOf(node.category, opts);
        nodes[node.id] = node;
        y += node.h + opts.nodePad;
      }
    }

    // Ribbons: order at each node by the other end's y, so they do not cross.
    var links = model.links.map(function (l) { return assign(l, {}); }).filter(function (l) { return nodes[l.source] && nodes[l.target]; });
    links.sort(function (a, b) {
      var sa = nodes[a.source], sb = nodes[b.source];
      if (sa.col !== sb.col) { return sa.col - sb.col; }
      if (sa.y !== sb.y) { return sa.y - sb.y; }
      return nodes[a.target].y - nodes[b.target].y;
    });
    for (i = 0; i < links.length; i++) {
      var l = links[i], s0 = nodes[l.source], t0 = nodes[l.target];
      l.h = l.value * scale;
      l.sy = s0.y + s0.sourceOffset; s0.sourceOffset += l.h;
      // A ribbon leaves the source's far edge and enters the target's near edge; mirrored, "far" and
      // "near" swap sides and the bezier simply runs right to left.
      if (mirror) { l.x0 = s0.x; l.x1 = t0.x + t0.w; } else { l.x0 = s0.x + s0.w; l.x1 = t0.x; }
    }
    // Target-side order must follow source y, or ribbons twist inside the node.
    var byTarget = {};
    for (i = 0; i < links.length; i++) { (byTarget[links[i].target] = byTarget[links[i].target] || []).push(links[i]); }
    for (var tId in byTarget) {
      if (!Object.prototype.hasOwnProperty.call(byTarget, tId)) { continue; }
      var arr = byTarget[tId].sort(function (a, b) { return a.sy - b.sy; });
      var off = 0;
      for (j = 0; j < arr.length; j++) { arr[j].ty = nodes[tId].y + off; off += arr[j].h; }
    }

    // Labels in every column: pinned to their node's centre, dodged so none overlap within the
    // column, pushed back up if the stack would run off the bottom. The right-hand column is one
    // line per label. The origin and category columns are two lines while a column's labels fit
    // the band at that pitch, one line otherwise -- a small category (a 2% "Military" under a 73%
    // "Enrolled") has a node a few pixels tall and a label thirty pixels tall, and without this
    // the labels of every small category land on top of each other.
    var bottomLimit = top + flowH;
    function dodge(list, spacing) {
      var q, ys = [], prev = -Infinity;
      for (q = 0; q < list.length; q++) { var want = list[q].y + list[q].h / 2; var ly = Math.max(want, prev + spacing); ys.push(ly); prev = ly; }
      if (ys.length && ys[ys.length - 1] + spacing / 2 > bottomLimit) {
        var shift = ys[ys.length - 1] + spacing / 2 - bottomLimit;
        for (q = ys.length - 1; q >= 0; q--) { ys[q] -= shift; if (q > 0 && ys[q - 1] + spacing <= ys[q]) { break; } }
      }
      for (q = 0; q < list.length; q++) { list[q].labelY = ys[q]; }
    }
    var twoLine = [false, false, false];
    for (c = 0; c < 3; c++) {
      var list = cols[c].map(function (n) { return nodes[n.id]; }).sort(function (a, b) { return a.y - b.y; });
      twoLine[c] = c < 2 && list.length * opts.twoLineHeight <= flowH;
      dodge(list, twoLine[c] ? opts.twoLineHeight : opts.labelHeight);
    }

    return {
      width: width, height: height, top: top, flowH: flowH, scale: scale, twoLine: twoLine, mirror: mirror,
      xs: xs, nodes: nodes, columns: cols.map(function (col) { return col.map(function (n) { return nodes[n.id]; }); }),
      links: links, model: model, opts: opts
    };
  }

  // ---------------------------------------------------------------------------
  // renderSVG: layout -> SVG markup. Text is escaped; nothing here is interactive
  // beyond native <title> tooltips, which work inside the dashboard iframe.
  // ---------------------------------------------------------------------------
  function ribbonPath(l) {
    var mx = (l.x0 + l.x1) / 2;
    return "M" + l.x0 + "," + l.sy +
      " C" + mx + "," + l.sy + " " + mx + "," + l.ty + " " + l.x1 + "," + l.ty +
      " L" + l.x1 + "," + (l.ty + l.h) +
      " C" + mx + "," + (l.ty + l.h) + " " + mx + "," + (l.sy + l.h) + " " + l.x0 + "," + (l.sy + l.h) + " Z";
  }

  function renderSVG(lay) {
    var opts = lay.opts, model = lay.model, m = opts.margin;
    var W = lay.width, H = lay.height, out = [], i;
    var f = "font-family=\"Segoe UI, Tableau, Arial, sans-serif\"";

    out.push("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" + W + "\" height=\"" + H + "\" viewBox=\"0 0 " + W + " " + H + "\" " + f + " font-size=\"12\">");
    out.push("<style>.halo{paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}.rib{opacity:.42}.rib:hover{opacity:.8}.nd{stroke:#fff;stroke-width:1}</style>");

    // --- headline strip -------------------------------------------------------
    var unit = opts.unit || "students";
    var hasStayed = model.stayed > 0 && !opts.includeStayed;   // the flow is a subset only when someone stayed
    var phrase = opts.notStayedPhrase || "did not stay";         // "did not stay" outbound; an inbound flow says "came from here"
    var title = opts.title || originTitle(model.columns[0], opts.originNoun);
    var parts = [fmtInt(model.total) + " " + unit];
    for (i = 0; i < model.headline.length; i++) { parts.push(model.headline[i].short + " " + fmtPct(model.headline[i].pct)); }
    var sub = parts.join("  ·  ");
    out.push("<text x=\"" + m + "\" y=\"" + (m + 15) + "\" font-size=\"16\" font-weight=\"600\" fill=\"#1f2a37\">" + esc(title) + "</text>");
    out.push("<text x=\"" + m + "\" y=\"" + (m + 33) + "\" fill=\"#5a5a5a\">" + esc(sub) + "</text>");

    var barY = m + 42, barH = 14, barX = m, barW = W - 2 * m, cx = barX;
    for (i = 0; i < model.headline.length; i++) {
      var h = model.headline[i], w = barW * h.pct;
      out.push("<rect x=\"" + cx + "\" y=\"" + barY + "\" width=\"" + w + "\" height=\"" + barH + "\" fill=\"" + h.color + "\"><title>" + esc(h.category + ": " + fmtInt(h.count) + " · " + fmtPct(h.pct)) + "</title></rect>");
      cx += w;
    }

    // --- ribbons ---------------------------------------------------------------
    for (i = 0; i < lay.links.length; i++) {
      var l = lay.links[i], s = lay.nodes[l.source], t = lay.nodes[l.target];
      // The arrow reads in drawing order: left to right. Mirrored, the students flow from the
      // right-hand column's sources into the origin, so the target is named first.
      var tip = (lay.mirror ? t.label + " → " + s.label : s.label + " → " + t.label) + ": " + fmtInt(l.value) + " " + unit + " · " + fmtPct(l.pct) + " of all " + fmtInt(model.total);
      if (hasStayed) { tip += " · " + fmtPct(l.pctOfFlow) + " of those who " + phrase; }
      out.push("<path class=\"rib\" d=\"" + ribbonPath(l) + "\" fill=\"" + colorOf(l.category, opts) + "\"><title>" + esc(tip) + "</title></path>");
    }
    // Percent on the ribbon itself where it is tall enough to carry one.
    for (i = 0; i < lay.links.length; i++) {
      var lk = lay.links[i];
      if (lk.h >= opts.minRibbonLabel && lay.nodes[lk.source].col === 1 && Math.abs(lk.x1 - lk.x0) >= 220) {
        var lx = (lk.x0 + lk.x1) / 2, ly = (lk.sy + lk.ty) / 2 + lk.h / 2 + 4;
        out.push("<text class=\"halo\" x=\"" + lx + "\" y=\"" + ly + "\" text-anchor=\"middle\" font-size=\"11\" fill=\"#1f2a37\">" + esc(fmtPct(lk.pct)) + "</text>");
      }
    }

    // --- nodes -----------------------------------------------------------------
    var id;
    for (id in lay.nodes) {
      if (!Object.prototype.hasOwnProperty.call(lay.nodes, id)) { continue; }
      var n = lay.nodes[id];
      out.push("<rect class=\"nd\" x=\"" + n.x + "\" y=\"" + n.y + "\" width=\"" + n.w + "\" height=\"" + Math.max(n.h, 1) + "\" fill=\"" + n.color + "\"><title>" + esc(n.label + ": " + fmtInt(n.size) + " · " + fmtPct(n.pct)) + "</title></rect>");
    }

    // --- labels ----------------------------------------------------------------
    function leader(x0, y0, x1, y1) { return "<path d=\"M" + x0 + "," + y0 + " L" + x1 + "," + y1 + "\" fill=\"none\" stroke=\"#b8bec7\" stroke-width=\"1\"/>"; }
    // Column 0: right-aligned in the left gutter; two lines while they fit, with a leader line
    // when the label had to move off its node.
    var c0 = lay.columns[0];
    for (i = 0; i < c0.length; i++) {
      var o = c0[i], ocy = o.y + o.h / 2, oy = o.labelY != null ? o.labelY : ocy;
      // Numbers in parentheses after every name (Kent, 2026-09-11). When the gutter is capped by
      // a narrow zone, drop the suffix rather than clip the count.
      var oNums = "(" + fmtInt(o.size) + " · " + fmtPct(o.pct) + (hasStayed ? " " + phrase : "") + ")";
      if (oNums.length > (opts.leftNumChars || 99)) { oNums = "(" + fmtInt(o.size) + " · " + fmtPct(o.pct) + ")"; }
      // Mirrored, the origin sits on the right and its label hangs off the node's right edge.
      var oX = lay.mirror ? o.x + o.w + 8 : o.x - 8, oAnchor = lay.mirror ? "start" : "end";
      if (Math.abs(oy - ocy) > 2) { out.push(lay.mirror ? leader(o.x + o.w, ocy, o.x + o.w + 6, oy) : leader(o.x, ocy, o.x - 6, oy)); }
      if (lay.twoLine[0]) {
        out.push("<text x=\"" + oX + "\" y=\"" + (oy - 3) + "\" text-anchor=\"" + oAnchor + "\" font-weight=\"600\" fill=\"#1f2a37\"><title>" + esc(o.label) + "</title>" + esc(clip(o.label, opts.leftChars)) + "</text>");
        out.push("<text x=\"" + oX + "\" y=\"" + (oy + 13) + "\" text-anchor=\"" + oAnchor + "\" fill=\"#5a5a5a\">" + esc(oNums) + "</text>");
      } else {
        out.push("<text x=\"" + oX + "\" y=\"" + (oy + 4) + "\" text-anchor=\"" + oAnchor + "\" font-weight=\"600\" fill=\"#1f2a37\"><title>" + esc(o.label + " " + oNums) + "</title>" + esc(clip(o.label, opts.leftChars)) + "<tspan font-weight=\"400\" fill=\"#5a5a5a\"> " + esc(oNums) + "</tspan></text>");
      }
    }
    // Column 1: to the right of the node, over the outgoing ribbons, with a halo; same rule.
    var c1 = lay.columns[1];
    for (i = 0; i < c1.length; i++) {
      var k = c1[i], kcy = k.y + k.h / 2, ky = k.labelY != null ? k.labelY : kcy;
      // The category label sits over the ribbons that leave the node toward the destinations:
      // to the right of the node normally, to the left when mirrored.
      var kx = lay.mirror ? k.x - 6 : k.x + k.w + 6, kAnchor = lay.mirror ? " text-anchor=\"end\"" : "";
      var kNums = "(" + fmtInt(k.size) + " · " + fmtPct(k.pct) + ")";
      if (Math.abs(ky - kcy) > 2) { out.push(lay.mirror ? leader(k.x, kcy, kx + 2, ky) : leader(k.x + k.w, kcy, kx - 2, ky)); }
      if (lay.twoLine[1]) {
        out.push("<text class=\"halo\" x=\"" + kx + "\" y=\"" + (ky - 2) + "\"" + kAnchor + " font-weight=\"600\" fill=\"#1f2a37\">" + esc(k.short) + "</text>");
        out.push("<text class=\"halo\" x=\"" + kx + "\" y=\"" + (ky + 13) + "\"" + kAnchor + " fill=\"#5a5a5a\">" + esc(kNums) + "</text>");
      } else {
        out.push("<text class=\"halo\" x=\"" + kx + "\" y=\"" + (ky + 4) + "\"" + kAnchor + " font-weight=\"600\" fill=\"#1f2a37\">" + esc(k.short) + "<tspan font-weight=\"400\" fill=\"#5a5a5a\"> " + esc(kNums) + "</tspan></text>");
      }
    }
    // Column 2: in the right gutter, with a leader line when the label had to move.
    var c2 = lay.columns[2];
    for (i = 0; i < c2.length; i++) {
      var d = c2[i], cy = d.y + d.h / 2, lyy = d.labelY != null ? d.labelY : cy;
      // Mirrored, the destinations are the left-hand column and their labels sit in the left gutter.
      var tx = lay.mirror ? d.x - 10 : d.x + d.w + 10, tAnchor = lay.mirror ? " text-anchor=\"end\"" : "";
      if (Math.abs(lyy - cy) > 2) {
        out.push(lay.mirror
          ? "<path d=\"M" + d.x + "," + cy + " L" + (d.x - 5) + "," + cy + " L" + (tx + 3) + "," + lyy + "\" fill=\"none\" stroke=\"#b8bec7\" stroke-width=\"1\"/>"
          : "<path d=\"M" + (d.x + d.w) + "," + cy + " L" + (d.x + d.w + 5) + "," + cy + " L" + (tx - 3) + "," + lyy + "\" fill=\"none\" stroke=\"#b8bec7\" stroke-width=\"1\"/>");
      }
      var name = foldName(d, opts);
      var nums = "(" + fmtInt(d.size) + " · " + fmtPct(d.pct) + ")";
      var room = opts.rightChars - nums.length - 1;
      out.push("<text x=\"" + tx + "\" y=\"" + (lyy + 4) + "\"" + tAnchor + " fill=\"#1f2a37\"><title>" + esc(name + " " + nums) + "</title>" + esc(clip(name, room)) +
        "<tspan fill=\"#5a5a5a\"> " + esc(nums) + "</tspan></text>");
    }

    // --- footer ----------------------------------------------------------------
    out.push("<text x=\"" + m + "\" y=\"" + (H - 6) + "\" font-size=\"11\" fill=\"#8a8f98\">" +
      esc("Percentages are of all " + fmtInt(model.total) + " " + unit + (hasStayed ? ", including the " + fmtInt(model.stayed) + " who stayed. Hover a ribbon for the share of those who " + phrase + "." : ".")) + "</text>");

    out.push("</svg>");
    return out.join("");
  }

  function render(rows, width, height, options) {
    var model = buildModel(rows, options);
    var lay = layout(model, width, height, options);
    return { svg: renderSVG(lay), layout: lay, model: model };
  }

  global.FeederFlow = {
    buildModel: buildModel, collapseToFit: collapseToFit, layout: layout, renderSVG: renderSVG, render: render,
    fmtInt: fmtInt, fmtPct: fmtPct, esc: esc, clip: clip, originTitle: originTitle, foldName: foldName, resolveColors: resolveColors, colorOf: colorOf,
    CATEGORY_COLOR: CATEGORY_COLOR, CATEGORY_ORDER: CATEGORY_ORDER, CATEGORY_SHORT: CATEGORY_SHORT, PALETTE: PALETTE, DEFAULTS: DEFAULTS
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
