/*
 * CUSD PDF Print — in-dashboard logic
 * ----------------------------------
 * WHY THIS EXISTS
 *
 * Tableau's own PDF export (Download > PDF, the Download object, subscriptions)
 * is rendered SERVER-SIDE, and the server renderer does not run dashboard
 * extensions at all. Every extension object therefore comes out blank. That is
 * Tableau's documented behaviour, not a bug we can patch: on Tableau Cloud only
 * Tableau-governed "trusted" extensions and Pulse objects are included in
 * exports, and PDF/PowerPoint exclude even those.
 *
 * The BROWSER's own print path is different: it prints the live page, and a live
 * page renders its iframes, extensions included. That is why Ctrl+P looks right
 * and the PDF button does not.
 *
 * So this extension does not try to fix Tableau's exporter. It routes the click
 * to the browser print path instead.
 *
 * WHY IT NEEDS A SEPARATE WINDOW
 *
 * The obvious implementation — call window.top.print() — is impossible. An
 * extension runs in a cross-origin iframe (our host, not Tableau's), and the
 * same-origin policy does not expose print() on a cross-origin parent. There is
 * no Extensions API call for printing either. What an extension CAN do is open a
 * window on its OWN origin; that window is same-origin, so it can print itself,
 * and what it prints includes the dashboard it has framed.
 *
 *   dashboard  ->  this button  ->  print.html (our origin, so it can print)
 *                                     └─ iframe: the same view, :embed=y, same
 *                                        filters, same size — extensions and all
 *
 * No district data passes through the host: the framed copy is fetched by the
 * viewer's own browser from Tableau, under the viewer's own session, so
 * row-level security applies to the printout exactly as it does on screen.
 */
(function () {
  "use strict";

  var L = window.CusdPdfPrint;

  var wrap = document.getElementById("wrap");
  var btn = document.getElementById("pdfBtn");
  var statusEl = document.getElementById("status");

  /*
   * Are we the copy of this extension running INSIDE the print window's framed
   * dashboard? If so, render nothing: the button is dashboard furniture, and a
   * PDF of the dashboard should not have a "make a PDF" button sitting in it.
   *
   * A dashboard viewed normally on Tableau Cloud puts this iframe one level
   * down, so parent === top. Inside print.html the framed viz adds a level, so
   * parent !== top. Caveat, and it is a real one: if CUSD ever embeds a
   * dashboard in an intranet portal page, that is also two levels deep and the
   * button would hide there too. Noted in README > Known limitations.
   */
  function isNestedCopy() {
    try { return window.parent !== window.top; } catch (e) { return true; }
  }

  if (isNestedCopy()) {
    if (wrap) { wrap.hidden = true; }
    // Still initialise, so Tableau does not sit on "Loading…" in the framed copy.
    if (typeof tableau !== "undefined" && tableau.extensions) {
      tableau.extensions.initializeAsync().catch(function () { /* nothing to show anyway */ });
    }
    return;
  }

  if (!L) {
    if (statusEl) { statusEl.textContent = "print-url.js did not load."; statusEl.className = "status error"; }
    console.error("CUSD PDF Print: print-url.js not found — check the file list at the host.");
    return;
  }

  if (typeof tableau === "undefined" || !tableau.extensions) {
    setStatus("Tableau library not loaded — check the lib/ folder.", true);
    console.error("CUSD PDF Print: Tableau Extensions API not found — is lib/tableau.extensions.1.latest.min.js present at the host?");
    return;
  }

  var KEYS = {
    viewUrl: "viewUrl",
    paper: "paper",
    marginIn: "marginIn",
    settleMs: "settleMs",
    autoPrint: "autoPrint",
    carryFilters: "carryFilters"
  };

  // ---- status line ---------------------------------------------------------
  var statusTimer = null;
  function setStatus(msg, isError) {
    if (!statusEl) { return; }
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("error", !!isError);
    if (msg) {
      statusTimer = setTimeout(function () {
        statusEl.textContent = "";
        statusEl.classList.remove("error");
      }, isError ? 8000 : 3000);
    }
  }

  function getSetting(key, fallback) {
    var v = tableau.extensions.settings.get(key);
    return (v === undefined || v === null || v === "") ? fallback : v;
  }

  function getNumberSetting(key, fallback) {
    var n = parseFloat(getSetting(key, ""));
    return isFinite(n) ? n : fallback;
  }

  function getBoolSetting(key, fallback) {
    var v = getSetting(key, null);
    if (v === null) { return fallback; }
    return String(v) === "true";
  }

  // ---- reading the dashboard's current state -------------------------------

  /*
   * Flatten every worksheet's filters into the plain descriptors print-url.js
   * understands, de-duplicated by field name. One unreadable worksheet must not
   * fail the whole gather, so each is wrapped on its own.
   *
   * Metadata only — field names and the selections already visible on screen.
   * No getSummaryDataAsync, no underlying data, so no data rows are read.
   */
  async function gatherFilters(dashboard) {
    var seen = {};
    var out = [];
    for (var i = 0; i < dashboard.worksheets.length; i++) {
      var filters;
      try {
        filters = await dashboard.worksheets[i].getFiltersAsync();
      } catch (e) {
        continue;
      }
      for (var f = 0; f < filters.length; f++) {
        var flt = filters[f];
        if (seen[flt.fieldName]) { continue; }
        seen[flt.fieldName] = true;
        out.push({
          kind: "filter",
          field: flt.fieldName,
          type: flt.filterType,
          allSelected: !!flt.isAllSelected,
          values: (flt.appliedValues || []).map(function (v) {
            // The URL must carry the underlying value, not the formatted label:
            // a filter on a date or a number is matched on its real value.
            return (v.value !== undefined && v.value !== null) ? v.value : v.formattedValue;
          })
        });
      }
    }
    return out;
  }

  async function gatherParameters(dashboard) {
    try {
      var params = await dashboard.getParametersAsync();
      return params.map(function (p) {
        var cv = p.currentValue;
        return {
          kind: "parameter",
          field: p.name,
          type: "parameter",
          values: (cv && cv.value !== undefined && cv.value !== null) ? [cv.value] : []
        };
      });
    } catch (e) {
      return [];
    }
  }

  // ---- linking the dashboard ----------------------------------------------

  /*
   * The view URL is NOT required to add, configure or publish this extension,
   * and it deliberately cannot be: a dashboard being built has never been
   * published, so its view URL does not exist yet. Requiring it up front is a
   * chicken-and-egg — you would have to know the address of something that does
   * not exist to be allowed to create it. (Kent, 2026-09-14.)
   *
   * So the link is captured at FIRST USE instead: the print window asks for it
   * once, prints immediately with whatever is pasted, and hands it back here to
   * be stored. Storing needs authoring mode, which is Desktop or Edit on the
   * web; from a plain view the print still works, it just is not remembered.
   */
  function isAuthoring() {
    try { return tableau.extensions.environment.mode === "authoring"; }
    catch (e) { return false; }
  }

  function replyUrlStatus(saved, message) {
    if (printWindow && !printWindow.closed) {
      printWindow.postMessage(
        { type: "cusd-pdf-print:urlstatus", saved: saved, message: message },
        window.location.origin);
    }
  }

  function persistViewUrl(raw) {
    var check = L.normalizeViewUrl(raw);
    if (!check.ok) { replyUrlStatus(false, check.problem); return; }

    if (!isAuthoring()) {
      replyUrlStatus(false,
        "Printed, but the link was not saved: this dashboard is open for viewing. " +
        "To store it, open the dashboard in Edit on the web (or in Tableau Desktop) " +
        "and click the PDF button once there.");
      return;
    }

    var s = tableau.extensions.settings;
    s.set(KEYS.viewUrl, check.url);
    s.saveAsync()
      .then(function () {
        replyUrlStatus(true,
          "Saved. This dashboard is linked — publish or save the workbook to keep it.");
        setStatus("Dashboard link saved.");
      })
      .catch(function (err) {
        replyUrlStatus(false,
          "Could not save the link: " + (err && err.message ? err.message : "unknown error"));
      });
  }

  // ---- the print window handshake -----------------------------------------
  // The window is opened synchronously inside the click (so the pop-up blocker
  // lets it through) but the payload is not ready until the async gather above
  // finishes. Both sides therefore announce themselves and whichever arrives
  // second triggers the send.

  var printWindow = null;
  var pendingPayload = null;
  var printWindowReady = false;

  function flushPayload() {
    if (!printWindowReady || !pendingPayload || !printWindow || printWindow.closed) { return; }
    printWindow.postMessage(pendingPayload, window.location.origin);
    pendingPayload = null;
  }

  window.addEventListener("message", function (event) {
    // Same-origin only: print.html is served from this extension's own host.
    if (event.origin !== window.location.origin) { return; }
    if (!event.data) { return; }
    if (event.data.type === "cusd-pdf-print:seturl") {
      persistViewUrl(event.data.viewUrl);
      return;
    }
    if (event.data.type !== "cusd-pdf-print:ready") { return; }
    printWindowReady = true;
    flushPayload();
  });

  // ---- main click handler --------------------------------------------------

  async function onPrintClick() {
    // A link that is merely MISSING is fine — the print window asks for one and
    // prints anyway. A link that is present and WRONG is not: say so here rather
    // than opening a window that will frame the wrong thing.
    var stored = L.normalizeViewUrl(getSetting(KEYS.viewUrl, ""));
    if (!stored.ok && !stored.missing) {
      setStatus(stored.problem, true);
      return;
    }

    // Opened inside the click gesture, before any await, or the browser treats
    // it as an unsolicited pop-up and blocks it.
    printWindowReady = false;
    pendingPayload = null;
    // A stale window is closed and the new one gets a UNIQUE name. Reusing one
    // name means the browser may re-target the existing window without
    // reloading it — and an already-loaded print.html never sends its "ready"
    // handshake again, so the payload would have nowhere to go and the window
    // would sit on "Preparing…" forever.
    if (printWindow && !printWindow.closed) { printWindow.close(); }
    printWindow = window.open(
      new URL("./print.html", window.location.href).href,
      "cusdPdfPrint" + Date.now(),
      "width=1280,height=900,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes"
    );
    if (!printWindow) {
      setStatus("Your browser blocked the print window. Allow pop-ups for this site and click again.", true);
      return;
    }

    setStatus("Preparing the printable copy…");
    try {
      var dashboard = tableau.extensions.dashboardContent.dashboard;
      var filters = await gatherFilters(dashboard);
      var parameters = await gatherParameters(dashboard);

      // dashboard.size is a sizing RULE, not a pixel box — see
      // print-url.js > measureDashboard.
      var measured = L.measureDashboard(dashboard.objects, dashboard.size);

      // The print window ASSEMBLES the URL rather than receiving a finished one.
      // It has to: when the dashboard is not linked yet, the view URL arrives
      // from the operator in that window, and the filters still have to be
      // folded into it there. One assembler, one code path, linked or not.
      pendingPayload = {
        type: "cusd-pdf-print:payload",
        viewUrl: stored.ok ? stored.url : "",
        needsUrl: !stored.ok,
        // Whether this session can REMEMBER a pasted link. Saving settings needs
        // authoring mode (Desktop, or Edit on the web); from a plain view the
        // print works and the link does not stick.
        canSaveUrl: isAuthoring(),
        filters: filters.concat(parameters),
        size: { w: measured.w, h: measured.h },
        carryFilters: getBoolSetting(KEYS.carryFilters, L.DEFAULTS.carryFilters),
        maxUrlLength: L.DEFAULTS.maxUrlLength,
        dashboardName: dashboard.name,
        dashW: measured.w,
        dashH: measured.h,
        sizeSource: measured.source,
        paper: getSetting(KEYS.paper, L.DEFAULTS.paper),
        marginIn: getNumberSetting(KEYS.marginIn, L.DEFAULTS.marginIn),
        settleMs: getNumberSetting(KEYS.settleMs, L.DEFAULTS.settleMs),
        autoPrint: getBoolSetting(KEYS.autoPrint, L.DEFAULTS.autoPrint)
      };
      flushPayload();
      setStatus("Opening the print view…");
    } catch (err) {
      if (printWindow && !printWindow.closed) { printWindow.close(); }
      console.error("CUSD PDF Print failed:", err);
      setStatus("Couldn't prepare the printable copy: " + (err && err.message ? err.message : "unknown error"), true);
    }
  }

  // ---- Configure… dialog (author-only) -------------------------------------
  function openConfigure() {
    // The dialog loads print-url.js itself, so PAPERS and DEFAULTS are not
    // passed across — one copy, no chance of the two disagreeing.
    var payload = JSON.stringify({
      // The host actually serving this dashboard, so the dialog can warn when
      // the pasted URL points at a different Tableau site.
      hostHint: (function () {
        try { return window.location.ancestorOrigins ? window.location.ancestorOrigins[0] : ""; }
        catch (e) { return ""; }
      })(),
      current: {
        viewUrl: getSetting(KEYS.viewUrl, ""),
        paper: getSetting(KEYS.paper, L.DEFAULTS.paper),
        marginIn: getNumberSetting(KEYS.marginIn, L.DEFAULTS.marginIn),
        settleMs: getNumberSetting(KEYS.settleMs, L.DEFAULTS.settleMs),
        autoPrint: getBoolSetting(KEYS.autoPrint, L.DEFAULTS.autoPrint),
        carryFilters: getBoolSetting(KEYS.carryFilters, L.DEFAULTS.carryFilters)
      }
    });
    var url = new URL("./configure.html", window.location.href).href;

    tableau.extensions.ui.displayDialogAsync(url, payload, { height: 560, width: 520 })
      .then(function (closePayload) {
        if (!closePayload || closePayload === "cancel") { return; }
        var cfg = JSON.parse(closePayload);
        var s = tableau.extensions.settings;
        s.set(KEYS.viewUrl, (cfg.viewUrl || "").trim());
        s.set(KEYS.paper, cfg.paper || L.DEFAULTS.paper);
        s.set(KEYS.marginIn, String(cfg.marginIn));
        s.set(KEYS.settleMs, String(cfg.settleMs));
        s.set(KEYS.autoPrint, String(!!cfg.autoPrint));
        s.set(KEYS.carryFilters, String(!!cfg.carryFilters));
        return s.saveAsync();
      })
      .then(function () { setStatus(""); })
      .catch(function (err) {
        if (err && err.errorCode === tableau.ErrorCodes.DialogClosedByUser) { return; }
        console.error("Configure dialog error:", err);
      });
  }

  // ---- bootstrap -----------------------------------------------------------
  tableau.extensions.initializeAsync({ configure: openConfigure })
    .then(function () {
      btn.addEventListener("click", onPrintClick);
      // Silence at rest when the dashboard simply is not linked yet — that is a
      // working state, and the print window asks for the link on the first
      // click. Only a link that is stored AND malformed is worth a warning here.
      var atRest = L.normalizeViewUrl(getSetting(KEYS.viewUrl, ""));
      if (!atRest.ok && !atRest.missing) {
        setStatus(atRest.problem, true);
      }
    })
    .catch(function (err) {
      console.error("Failed to initialize CUSD PDF Print:", err);
      setStatus("Could not initialize the extension.", true);
    });
})();
