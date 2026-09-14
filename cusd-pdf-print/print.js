/*
 * CUSD PDF Print — the print window
 * ---------------------------------
 * This page is served from the extension's OWN host, which is the whole point:
 * it is same-origin with the extension, so it is allowed to print itself, and
 * what it prints is whatever it has framed — including the dashboard's extension
 * iframes, which Tableau's server-side PDF exporter never renders.
 *
 * It receives the view URL (already carrying the dashboard's current filters and
 * parameters) from the button that opened it, frames it, scales it onto the
 * chosen paper, and prints.
 *
 * A NOTE ON transform VS zoom.
 * cusd-pdf-builder's rule is "zoom, not transform: scale", because zoom
 * re-lays-out and a generated sheet SHOULD reflow into its smaller box. Here the
 * rule is deliberately inverted, and the reason is the content: a dashboard is a
 * fixed pixel canvas, and the printout has to be a picture of what the viewer is
 * looking at. Reflowing it would move marks, rewrap labels and re-pick device
 * layouts, i.e. print a different dashboard. So this is a photographic
 * reduction. The hazard transform carries — painting a full-size box outside its
 * own bounds — is closed by sizing .stage to the SCALED dimensions, so the
 * layout box and the painted box are the same rectangle.
 */
(function () {
  "use strict";

  var L = window.CusdPdfPrint;

  var els = {
    title: document.getElementById("title"),
    printBtn: document.getElementById("printBtn"),
    tabBtn: document.getElementById("tabBtn"),
    closeBtn: document.getElementById("closeBtn"),
    paper: document.getElementById("paper"),
    fit: document.getElementById("fit"),
    notice: document.getElementById("notice"),
    pageRule: document.getElementById("pageRule"),
    stage: document.getElementById("stage"),
    viz: document.getElementById("viz"),
    linkbox: document.getElementById("linkbox"),
    linkUrl: document.getElementById("linkUrl"),
    linkBtn: document.getElementById("linkBtn"),
    linkHint: document.getElementById("linkHint"),
    linkError: document.getElementById("linkError")
  };

  // If the opener never answers, the operator must be told rather than left
  // looking at "Preparing…" forever.
  var HANDSHAKE_TIMEOUT_MS = 20000;

  var payload = null;
  var handshakeTimer = null;
  var settleTimer = null;
  var hasPrintedOnce = false;
  var built = null;        // the assembled print URL + what survived the trip
  var loadStarted = false; // the iframe is pointed at the view exactly once

  // ---- notices -------------------------------------------------------------

  function showNotice(html, isError) {
    els.notice.innerHTML = html;
    els.notice.classList.toggle("error", !!isError);
    els.notice.hidden = false;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /*
   * Everything the operator needs to know before trusting the printout.
   *
   * A printed dashboard looks authoritative, so a filter that did not survive
   * the round-trip has to be NAMED here — never dropped quietly. A range or
   * relative-date filter cannot be expressed in a view URL at all, so the framed
   * copy falls back to whatever the published view has saved, and that may not
   * be what is on screen.
   */
  function renderNotices(fit) {
    var bits = [];

    var unsafe = built ? (built.skipped || []).concat(built.dropped || []) : [];
    if (unsafe.length) {
      var items = unsafe.map(function (s) {
        return "<li><strong>" + escapeHtml(s.field) + "</strong> — " + escapeHtml(s.reason) + "</li>";
      }).join("");
      bits.push(
        "<strong>Check these before you print.</strong> The copy below uses the " +
        "published view's own setting for " + unsafe.length + " filter" +
        (unsafe.length === 1 ? "" : "s") + ", which may differ from what you have on screen:" +
        "<ul>" + items + "</ul>"
      );
    }

    if (payload.sizeSource === "unknown") {
      bits.push(
        "<strong>The dashboard's size could not be read</strong>, so this copy is being " +
        "printed at the size of the page itself rather than scaled to match the dashboard. " +
        "Check the copy below against the dashboard before you print it."
      );
    }

    if (fit.belowFloor) {
      bits.push(
        "<strong>This dashboard is being reduced to " + Math.round(fit.scale * 100) + "%</strong> " +
        "to fit " + escapeHtml(fit.paper.label) + ", which is likely too small to read. " +
        "Pick a larger paper size above."
      );
    }

    if (bits.length) {
      showNotice(bits.join("<hr style='border:0;border-top:1px solid #e0c789;margin:8px 0'>"), false);
    } else {
      els.notice.hidden = true;
    }
  }

  // ---- fit -----------------------------------------------------------------

  /*
   * Measure, then scale. The dashboard's size is read from Tableau (dashboard.size)
   * rather than assumed, and the printable box is computed from the paper and
   * margin actually being used — so the box we scale against is by construction
   * the box we print onto.
   */
  function applyFit() {
    var fit = L.computeFit(payload.dashW, payload.dashH, els.paper.value, payload.marginIn);

    // The @page box. Explicit inches, and the SAME numbers the scale was
    // computed from.
    els.pageRule.textContent =
      "@page { size: " + fit.paper.wIn + "in " + fit.paper.hIn + "in; margin: " + fit.marginIn + "in; }";

    // The iframe keeps the dashboard's true size and is scaled visually...
    els.viz.style.width = fit.dashW + "px";
    els.viz.style.height = fit.dashH + "px";
    els.viz.style.transform = "scale(" + fit.scale + ")";

    // ...and the stage takes the scaled size, so the layout box equals the
    // painted box and nothing spills outside it.
    els.stage.style.width = fit.scaledW + "px";
    els.stage.style.height = fit.scaledH + "px";

    els.fit.textContent =
      fit.dashW + " x " + fit.dashH + " px, printed at " + Math.round(fit.scale * 100) + "%" +
      (fit.scale === 1 ? " (actual size)" : "");

    renderNotices(fit);
    return fit;
  }

  // ---- paper picker --------------------------------------------------------

  function buildPaperOptions(selected) {
    var html = "";
    for (var id in L.PAPERS) {
      if (!Object.prototype.hasOwnProperty.call(L.PAPERS, id)) { continue; }
      html += '<option value="' + id + '"' + (id === selected ? " selected" : "") + ">" +
              escapeHtml(L.PAPERS[id].label) + "</option>";
    }
    els.paper.innerHTML = html;
  }

  // ---- settle --------------------------------------------------------------

  /*
   * iframe.onload fires when the Tableau page's own load event fires, which is
   * well BEFORE the viz has finished drawing — and we cannot ask it, because it
   * is cross-origin. So the operator gets a visible countdown and then a live
   * Print button, and the auto-print (if the author left it on) waits out the
   * same delay. If the dashboard is slow, the operator just clicks Print again;
   * nothing is lost.
   */
  var settleStarted = false;
  function startSettle() {
    if (settleStarted) { return; }
    settleStarted = true;
    var remaining = Math.max(0, Math.round((payload.settleMs || L.DEFAULTS.settleMs) / 1000));

    function tick() {
      if (remaining > 0) {
        els.title.textContent = 'Rendering "' + payload.dashboardName + '" — ' + remaining + "s";
        remaining -= 1;
        settleTimer = setTimeout(tick, 1000);
        return;
      }
      els.title.textContent = payload.dashboardName;
      els.printBtn.disabled = false;
      if (payload.autoPrint && !hasPrintedOnce) {
        doPrint();
      }
    }
    tick();
  }

  function doPrint() {
    hasPrintedOnce = true;
    // Let the toolbar's own hide take effect before the dialog snapshots the page.
    setTimeout(function () { window.print(); }, 50);
  }

  // ---- payload -------------------------------------------------------------

  function onPayload(data) {
    payload = data;
    if (handshakeTimer) { clearTimeout(handshakeTimer); handshakeTimer = null; }

    els.title.textContent = 'Loading "' + payload.dashboardName + '"…';
    buildPaperOptions(payload.paper);
    applyFit();

    els.paper.addEventListener("change", function () {
      // Re-fit only. The iframe is deliberately NOT reloaded: re-fetching the
      // dashboard would re-render it (and re-run its extracts) for a change that
      // is purely about paper.
      applyFit();
    });

    els.tabBtn.addEventListener("click", function () {
      // The escape hatch. In its own tab the view loads first-party on Tableau's
      // origin, so it authenticates even in a browser that refuses a session
      // cookie to a framed copy; the operator then prints with Ctrl+P.
      if (built) { window.open(built.url, "_blank", "noopener"); }
    });

    els.linkBtn.addEventListener("click", onLinkSubmit);
    els.linkUrl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { onLinkSubmit(); }
    });

    if (payload.needsUrl) {
      askForLink();
    } else {
      startWithUrl(payload.viewUrl);
    }
  }

  // ---- linking -------------------------------------------------------------

  function askForLink() {
    els.title.textContent = 'Link "' + payload.dashboardName + '" to print it';
    els.linkbox.hidden = false;
    els.linkHint.textContent = payload.canSaveUrl
      ? "This is a one-time step: the link is saved into the workbook, so nobody is asked again. Publish or save the workbook afterwards to keep it."
      : "You are viewing this dashboard rather than editing it, so the link can be used now but not saved. To store it for everyone, do this once from Edit on the web, or in Tableau Desktop.";
    els.linkUrl.focus();
  }

  function onLinkSubmit() {
    els.linkError.textContent = "";
    var check = L.normalizeViewUrl(els.linkUrl.value);
    if (!check.ok) {
      els.linkError.textContent = check.problem;
      els.linkUrl.focus();
      return;
    }
    // Hand it back to the dashboard so it can be stored. That reply is
    // informational — the print goes ahead either way.
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: "cusd-pdf-print:seturl", viewUrl: check.url },
        window.location.origin);
    }
    els.linkbox.hidden = true;
    startWithUrl(check.url);
  }

  // ---- loading the framed copy --------------------------------------------

  function startWithUrl(viewUrl) {
    if (loadStarted) { return; }
    loadStarted = true;

    built = L.buildPrintUrl(viewUrl, {
      filters: payload.filters || [],
      size: payload.size,
      carryFilters: payload.carryFilters,
      maxUrlLength: payload.maxUrlLength
    });

    els.tabBtn.disabled = false;
    els.title.textContent = 'Loading "' + payload.dashboardName + '"…';
    applyFit();   // re-run now that `built` exists, so the notices list filters

    // An iframe with no src has already loaded about:blank. If that load event
    // lands after this listener is attached, the countdown would start — and
    // auto-print — on a blank page. So only the load of the URL we set counts,
    // and startSettle is idempotent besides, because Tableau navigates the frame
    // internally more than once.
    var srcSet = false;
    els.viz.addEventListener("load", function () {
      if (!srcSet) { return; }
      startSettle();
    });
    els.viz.src = built.url;
    srcSet = true;

    // Give the window roughly the shape of the page being printed, where the
    // browser allows it (many block resizeTo on windows the script did not open
    // itself, hence the guard).
    try {
      var fit = L.computeFit(payload.dashW, payload.dashH, els.paper.value, payload.marginIn);
      window.resizeTo(
        Math.min(screen.availWidth, Math.round(fit.scaledW) + 60),
        Math.min(screen.availHeight, Math.round(fit.scaledH) + 220)
      );
    } catch (e) { /* not allowed here; the stage is scrollable anyway */ }
  }

  // ---- bootstrap -----------------------------------------------------------

  if (!L) {
    els.title.textContent = "print-url.js did not load.";
    showNotice("The print window could not load its own code. Check the file list at the extension's host.", true);
    return;
  }

  els.closeBtn.addEventListener("click", function () { window.close(); });
  els.printBtn.addEventListener("click", doPrint);

  window.addEventListener("message", function (event) {
    if (event.origin !== window.location.origin) { return; }
    if (!event.data) { return; }
    if (event.data.type === "cusd-pdf-print:urlstatus") {
      // Whether the link stuck. Never blocks the print that is already running.
      showNotice(escapeHtml(event.data.message), !event.data.saved);
      return;
    }
    if (event.data.type !== "cusd-pdf-print:payload") { return; }
    if (payload) { return; }   // first payload wins; ignore repeats
    onPayload(event.data);
  });

  handshakeTimer = setTimeout(function () {
    els.title.textContent = "No dashboard was handed over.";
    showNotice(
      "This window never received the dashboard from the PDF button. Close it and click the " +
      "PDF button on the dashboard again. If it keeps happening, the dashboard tab may have " +
      "been closed or reloaded while this window was opening.", true);
  }, HANDSHAKE_TIMEOUT_MS);

  // Tell the opener we are ready to receive. The opener may still be gathering
  // the dashboard's filters, in which case it sends as soon as it has them.
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage({ type: "cusd-pdf-print:ready" }, window.location.origin);
  } else {
    els.title.textContent = "Opened without a dashboard.";
    showNotice("Open this window with the PDF button on a dashboard — it has nothing to print on its own.", true);
    if (handshakeTimer) { clearTimeout(handshakeTimer); handshakeTimer = null; }
  }
})();
