/*
 * CUSD PDF Print — pure logic (no DOM, no Tableau API)
 * ---------------------------------------------------
 * Everything in this file is a plain function of its arguments, so it can be
 * exercised offline by tests/test_pdf_print_extension.js. An extension cannot be
 * clicked without publishing it, so the parts that can be wrong silently — the
 * view-URL rewrite, the filter round-trip, the print scale — live here and are
 * tested here. pdf-print.js and print.js hold only the parts that need a browser.
 *
 * Exposed as window.CusdPdfPrint in the browser and as module.exports under Node.
 */
(function (root) {
  "use strict";

  // ---- paper -------------------------------------------------------------
  // Explicit inch dimensions rather than the CSS keywords (`size: letter
  // landscape`): Chrome honours explicit lengths consistently, and the same two
  // numbers drive both the @page rule and the scale arithmetic, so the box we
  // measure against is by construction the box we print onto.
  var PAPERS = {
    "letter-landscape":  { label: "Letter, landscape (11 x 8.5 in)",  wIn: 11,  hIn: 8.5 },
    "letter-portrait":   { label: "Letter, portrait (8.5 x 11 in)",   wIn: 8.5, hIn: 11 },
    "legal-landscape":   { label: "Legal, landscape (14 x 8.5 in)",   wIn: 14,  hIn: 8.5 },
    "tabloid-landscape": { label: "Tabloid, landscape (17 x 11 in)",  wIn: 17,  hIn: 11 }
  };

  var DEFAULTS = {
    paper: "letter-landscape",
    marginIn: 0.35,
    settleMs: 4000,     // how long the embedded dashboard gets to finish drawing
    autoPrint: true,
    carryFilters: true,
    maxUrlLength: 2000  // conservative ceiling; some proxies truncate past ~2k
  };

  // CSS reference pixels per inch. Fixed by the CSS spec, not by the printer.
  var CSS_PX_PER_IN = 96;

  // Below this the dashboard is legible only under a magnifier, so we say so
  // rather than shrinking it silently. Mirrors the 0.72 floor in
  // cusd-pdf-builder, set lower here because a dashboard is mostly marks and
  // gridlines rather than body text, and because the operator can still pick a
  // bigger sheet from the toolbar.
  var SCALE_FLOOR = 0.40;

  /*
   * Measure, then scale — never guess a number.
   *
   * The dashboard is a fixed pixel canvas we do NOT want reflowed (a reflowed
   * copy is a second layout, and it would stop being a picture of what the
   * viewer is looking at). So this is a photographic reduction: the scale is
   * read off the dashboard's own reported size against the printable box.
   *
   * Never scales ABOVE 1 — a small dashboard prints at its natural size rather
   * than being blown up into a blurry full-page enlargement.
   */
  function computeFit(dashW, dashH, paperId, marginIn) {
    var paper = PAPERS[paperId] || PAPERS[DEFAULTS.paper];
    var m = (typeof marginIn === "number" && marginIn >= 0) ? marginIn : DEFAULTS.marginIn;

    // A margin pair can't exceed the sheet; clamp before it produces a negative box.
    var maxMargin = Math.min(paper.wIn, paper.hIn) / 2 - 0.1;
    if (m > maxMargin) { m = Math.max(0, maxMargin); }

    var printableW = (paper.wIn - 2 * m) * CSS_PX_PER_IN;
    var printableH = (paper.hIn - 2 * m) * CSS_PX_PER_IN;

    var w = (dashW > 0) ? dashW : printableW;
    var h = (dashH > 0) ? dashH : printableH;

    var scale = Math.min(printableW / w, printableH / h, 1);

    return {
      paperId: PAPERS[paperId] ? paperId : DEFAULTS.paper,
      paper: paper,
      marginIn: m,
      printableW: printableW,
      printableH: printableH,
      dashW: w,
      dashH: h,
      scale: scale,
      scaledW: w * scale,
      scaledH: h * scale,
      // True when the reduction has gone past the point of legibility. The
      // caller must SAY so; it must not quietly print it anyway and it must not
      // clamp the scale back up, which would clip instead.
      belowFloor: scale < SCALE_FLOOR
    };
  }

  // ---- how big is the dashboard? ------------------------------------------

  /*
   * The print scale is only as good as the size it is measured against, and the
   * Extensions API does NOT hand you that size directly: Sheet.size is a SIZING
   * RULE — { behavior, maxSize?, minSize? } — not { width, height }. Reading
   * .width off it yields undefined, which would silently fall back to "print at
   * 100%" and clip every dashboard wider than the paper.
   *
   * So measure the dashboard from its own objects: each DashboardObject carries
   * position {x,y} and size {width,height} in pixels, and their union is the
   * laid-out dashboard AS CURRENTLY RENDERED in this viewer's browser. That is
   * the right answer for an Automatic-sized dashboard too, where there is no
   * fixed size to read.
   *
   * The sizing rule is the fallback, and "unknown" is a reportable third
   * outcome — never a silently assumed default.
   */
  function measureDashboard(objects, sizeRule) {
    var w = 0, h = 0;
    var list = objects || [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || !o.position || !o.size) { continue; }
      var right = o.position.x + o.size.width;
      var bottom = o.position.y + o.size.height;
      if (right > w) { w = right; }
      if (bottom > h) { h = bottom; }
    }
    if (w > 0 && h > 0) {
      return { w: Math.round(w), h: Math.round(h), source: "objects" };
    }

    var rule = sizeRule || {};
    var box = rule.maxSize || rule.minSize;
    if (box && box.width > 0 && box.height > 0) {
      return { w: Math.round(box.width), h: Math.round(box.height), source: "sizeRule" };
    }

    return { w: 0, h: 0, source: "unknown" };
  }

  // ---- filter / parameter round-trip --------------------------------------

  /*
   * Tableau's URL filtering uses the comma as the value separator, so a comma
   * INSIDE a value has to be backslash-escaped before the whole thing is
   * percent-encoded. A literal backslash has to be doubled first, or it would
   * eat the escape of a following comma.
   *
   * "Chandler High, East" -> "Chandler High\, East" -> "Chandler%20High%5C%2C%20East"
   */
  function encodeFilterValue(v) {
    return encodeURIComponent(normalizeValue(v).replace(/\\/g, "\\\\").replace(/,/g, "\\,"));
  }

  /*
   * A date filter or parameter hands back a real Date object, and String(date)
   * yields "Mon Sep 14 2026 00:00:00 GMT-0700 (Mountain Standard Time)" — which
   * Tableau does not parse, so the filter silently does not apply. Send the
   * yyyy-mm-dd form it does understand, taken from the LOCAL date parts rather
   * than toISOString(), which shifts to UTC and can move the date by a day.
   */
  function normalizeValue(v) {
    if (v instanceof Date && !isNaN(v.getTime())) {
      var mm = String(v.getMonth() + 1);
      var dd = String(v.getDate());
      return v.getFullYear() + "-" +
             (mm.length < 2 ? "0" + mm : mm) + "-" +
             (dd.length < 2 ? "0" + dd : dd);
    }
    return String(v);
  }

  // Which filter kinds survive a URL round-trip. Anything else has to be
  // REPORTED, never silently dropped: a printed dashboard carrying the wrong
  // filters is worse than no printout, because it looks authoritative.
  function filterCarryability(f) {
    if (f.kind === "parameter") {
      return (f.values && f.values.length === 1)
        ? { ok: true }
        : { ok: false, reason: "parameter has no readable current value" };
    }
    switch (f.type) {
      case "categorical":
        if (f.values && f.values.length) { return { ok: true }; }
        return { ok: false, reason: f.allSelected
          ? "set to (All) and Tableau did not expose the value list"
          : "no readable selection" };
      case "range":
        return { ok: false, reason: "range filters cannot be expressed in a view URL" };
      case "relative-date":
        return { ok: false, reason: "relative-date filters cannot be expressed in a view URL" };
      case "hierarchical":
        return { ok: false, reason: "hierarchical filters cannot be expressed in a view URL" };
      default:
        return { ok: false, reason: "unsupported filter type (" + f.type + ")" };
    }
  }

  // ---- URL assembly -------------------------------------------------------

  // Tableau's own control parameters all start with ":". We set these ourselves,
  // so any copy already sitting on the pasted URL is stripped rather than
  // duplicated (a repeated key is resolved differently by different hosts).
  var OWNED_KEYS = [
    ":embed", ":toolbar", ":tabs", ":showVizHome", ":showShareOptions",
    ":size", ":device", ":animate_transition", ":iid", ":origin", ":display_count",
    ":loadOrderID", ":showAppBanner"
  ];

  function isOwnedKey(pair) {
    var key = pair.split("=")[0];
    for (var i = 0; i < OWNED_KEYS.length; i++) {
      if (key === OWNED_KEYS[i]) { return true; }
    }
    return false;
  }

  /*
   * Append query parameters to a Tableau view URL.
   *
   * The wrinkle: a Tableau Cloud URL keeps the view path in the FRAGMENT
   *   https://host/#/site/cusd80/views/Workbook/Dashboard
   * so filter parameters belong after the fragment path, not on the document
   * query. A Tableau Server style URL
   *   https://host/t/site/views/Workbook/Dashboard
   * has no fragment and takes them on the ordinary query. Getting this backwards
   * produces a URL that loads the right view and silently ignores every filter.
   */
  function appendParams(url, pairs) {
    var hashIdx = url.indexOf("#");
    if (hashIdx >= 0) {
      return url.slice(0, hashIdx) + "#" + appendToQuery(url.slice(hashIdx + 1), pairs);
    }
    return appendToQuery(url, pairs);
  }

  function appendToQuery(s, pairs) {
    var qIdx = s.indexOf("?");
    var path = (qIdx >= 0) ? s.slice(0, qIdx) : s;
    var existing = (qIdx >= 0) ? s.slice(qIdx + 1) : "";

    var kept = [];
    if (existing) {
      var parts = existing.split("&");
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] && !isOwnedKey(parts[i])) { kept.push(parts[i]); }
      }
    }
    var all = kept.concat(pairs);
    return all.length ? (path + "?" + all.join("&")) : path;
  }

  /*
   * Build the URL the print window will frame.
   *
   * Returns the URL plus an honest account of what happened to the dashboard's
   * state: what was carried, what could not be, and what was dropped for length.
   * The caller shows `skipped` and `dropped` to the operator BEFORE printing.
   */
  function buildPrintUrl(viewUrl, opts) {
    opts = opts || {};
    var filters = opts.filters || [];
    var size = opts.size || null;
    var maxLength = opts.maxUrlLength || DEFAULTS.maxUrlLength;

    var control = [
      ":embed=y",
      ":showVizHome=no",
      ":toolbar=no",
      ":tabs=no",
      ":showShareOptions=false",
      ":animate_transition=no",
      // Pin the desktop layout. Without it a dashboard with device-specific
      // layouts re-picks one from the iframe width and the printout is a
      // different dashboard from the one on screen.
      ":device=desktop"
    ];
    if (size && size.w > 0 && size.h > 0) {
      control.push(":size=" + Math.round(size.w) + "," + Math.round(size.h));
    }

    var carried = [];
    var skipped = [];
    var dropped = [];

    var pairs = control.slice();

    if (opts.carryFilters !== false) {
      for (var i = 0; i < filters.length; i++) {
        var f = filters[i];
        var verdict = filterCarryability(f);
        if (!verdict.ok) {
          skipped.push({ field: f.field, reason: verdict.reason });
          continue;
        }
        var encodedValues = [];
        for (var v = 0; v < f.values.length; v++) {
          encodedValues.push(encodeFilterValue(f.values[v]));
        }
        var pair = encodeURIComponent(f.field) + "=" + encodedValues.join(",");

        // Length check against the URL as it would actually stand, so the
        // ceiling is measured, not estimated.
        var candidate = appendParams(viewUrl, pairs.concat([pair]));
        if (candidate.length > maxLength) {
          dropped.push({ field: f.field, reason: "URL length limit reached" });
          continue;
        }
        pairs.push(pair);
        carried.push(f.field);
      }
    }

    return {
      url: appendParams(viewUrl, pairs),
      carried: carried,
      skipped: skipped,
      dropped: dropped
    };
  }

  /*
   * A pasted URL is the one thing here a human types, so check it rather than
   * discovering the typo as a blank print window. Returns { ok, url, problem }.
   */
  function normalizeViewUrl(raw) {
    var s = String(raw || "").trim();
    if (!s) { return { ok: false, problem: "No dashboard URL has been set. Open Configure and paste the published view's URL." }; }
    if (!/^https:\/\//i.test(s)) { return { ok: false, problem: "The dashboard URL must start with https://" }; }
    if (!/\/views\//i.test(s)) { return { ok: false, problem: "That does not look like a published view URL — it should contain /views/." }; }
    return { ok: true, url: s };
  }

  // Compare the pasted URL's host against the host actually serving the
  // dashboard, so a URL pasted from a different Tableau site is caught in
  // Configure instead of printing somebody else's dashboard.
  function hostOf(url) {
    var m = /^https?:\/\/([^/?#]+)/i.exec(String(url || ""));
    return m ? m[1].toLowerCase() : "";
  }

  var api = {
    PAPERS: PAPERS,
    DEFAULTS: DEFAULTS,
    SCALE_FLOOR: SCALE_FLOOR,
    CSS_PX_PER_IN: CSS_PX_PER_IN,
    computeFit: computeFit,
    measureDashboard: measureDashboard,
    encodeFilterValue: encodeFilterValue,
    normalizeValue: normalizeValue,
    filterCarryability: filterCarryability,
    appendParams: appendParams,
    buildPrintUrl: buildPrintUrl,
    normalizeViewUrl: normalizeViewUrl,
    hostOf: hostOf
  };

  root.CusdPdfPrint = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
})(typeof window !== "undefined" ? window : this);
