/*
 * CUSD Request Help — in-dashboard logic
 * --------------------------------------
 * A Tableau Dashboard Extension that adds a single "Request help" button. When a
 * viewer clicks it, the extension gathers light CONTEXT about what they are
 * looking at — dashboard name, worksheet names, the current filter & parameter
 * selections, the Tableau environment, and a timestamp — and opens a pre-filled
 * email (mailto:) addressed to the team inbox the author configured. The viewer
 * reviews it, types their question, and sends it from their own mail client.
 *
 * Design notes / guardrails for CUSD:
 *   1. No backend, no secrets, no network calls. The message is assembled in the
 *      browser and handed to the OS mail client via a mailto: link. Nothing is
 *      transmitted by the extension and nothing is stored on the host.
 *   2. No data rows. It reads dashboard METADATA (names, filter/parameter
 *      selections, environment) only — never getSummaryData / underlying data —
 *      so no student/employee rows can ride along in the email. Aggregate
 *      context only.
 *   3. The recipient address, workbook name, and view URL are author-configured
 *      (Configure… dialog) and stored in the workbook's extension settings —
 *      there is no recipient hardcoded in this (public) repo.
 */
(function () {
  "use strict";

  // Settings keys (stored per-extension-instance via tableau.extensions.settings).
  var KEYS = {
    recipient: "recipient",       // team inbox email (author-set; no default in repo)
    workbookName: "workbookName", // optional label for the email
    viewUrl: "viewUrl"            // optional link back to the published view
  };

  // Keep the whole mailto: under a safe length — long mailto URLs get truncated
  // or rejected by some mail clients/browsers. We trim the variable-length
  // filter/parameter detail if the message would exceed this.
  var MAILTO_MAX = 1900;

  var btn = document.getElementById("helpBtn");
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
      }, isError ? 6000 : 2500);
    }
  }

  // --- settings helper ------------------------------------------------------
  // Treat undefined / null / "" all as "not set" so empty settings fall back.
  function getSetting(key, fallback) {
    var v = tableau.extensions.settings.get(key);
    return (v === undefined || v === null || v === "") ? fallback : v;
  }

  // --- context gatherers ----------------------------------------------------

  function envLabel() {
    try {
      var env = tableau.extensions.environment;
      var where = env.context === "desktop" ? "Tableau Desktop" : "Tableau Server/Cloud";
      return where + " · v" + env.tableauVersion;
    } catch (e) {
      return "(environment unavailable)";
    }
  }

  // Render one filter as a short "field: values" line. Returns null when there is
  // nothing useful to show (so the caller can skip it).
  function formatFilter(filter) {
    var field = filter.fieldName;
    try {
      switch (filter.filterType) {
        case "categorical":
          if (filter.isAllSelected) { return field + ": (all)"; }
          var vals = (filter.appliedValues || []).map(function (v) { return v.formattedValue; });
          if (!vals.length) { return null; }   // nothing applied / not readable — skip
          var shown = vals.slice(0, 6).join(", ");
          if (vals.length > 6) { shown += ", +" + (vals.length - 6) + " more"; }
          return field + ": " + shown;
        case "range":
          var lo = filter.minValue ? filter.minValue.formattedValue : "";
          var hi = filter.maxValue ? filter.maxValue.formattedValue : "";
          return field + ": " + lo + " – " + hi;
        case "relative-date":
          return field + ": (relative date)";
        default:
          return field + ": (" + filter.filterType + ")";
      }
    } catch (e) {
      return null;
    }
  }

  // Collect filters across all worksheets, de-duplicated by field name. Reading
  // filters is wrapped per-worksheet so one unreadable sheet never fails the
  // whole gather.
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
        var key = filters[f].fieldName;
        if (seen[key]) { continue; }
        var line = formatFilter(filters[f]);
        if (line) { seen[key] = true; out.push(line); }
      }
    }
    return out;
  }

  async function gatherParameters(dashboard) {
    try {
      var params = await dashboard.getParametersAsync();
      return params.map(function (p) {
        return p.name + ": " + (p.currentValue ? p.currentValue.formattedValue : "");
      });
    } catch (e) {
      return [];
    }
  }

  // --- email assembly -------------------------------------------------------

  function buildBody(ctx, truncateDetail) {
    var lines = [];
    lines.push("A help request was sent from a CUSD Research Tableau dashboard.");
    lines.push("");
    lines.push("Dashboard:   " + ctx.dashboardName);
    if (ctx.workbookName) { lines.push("Workbook:    " + ctx.workbookName); }
    if (ctx.viewUrl)      { lines.push("Link:        " + ctx.viewUrl); }
    if (ctx.worksheets)   { lines.push("Worksheets:  " + ctx.worksheets); }
    lines.push("Environment: " + ctx.environment);

    if (truncateDetail) {
      lines.push("Filters:     (omitted to keep this email within size limits — please describe below)");
      lines.push("Parameters:  (omitted — see note above)");
    } else {
      lines.push("Filters:     " + (ctx.filters.length ? ctx.filters.join(" · ") : "(none applied / not captured)"));
      lines.push("Parameters:  " + (ctx.parameters.length ? ctx.parameters.join(" · ") : "(none)"));
    }
    lines.push("Captured:    " + ctx.timestamp);
    lines.push("");
    lines.push("----------------------------------------");
    lines.push("Please describe the issue or request below:");
    lines.push("");
    lines.push("");
    lines.push("----------------------------------------");
    lines.push("(No dashboard data rows are included in this message.)");
    return lines.join("\r\n");
  }

  function buildMailto(recipient, subject, body) {
    return "mailto:" + encodeURIComponent(recipient) +
           "?subject=" + encodeURIComponent(subject) +
           "&body=" + encodeURIComponent(body);
  }

  // An anchor click is the most reliable way to hand a mailto: to the OS mail
  // client from inside the extension's iframe.
  function openMailto(url) {
    var a = document.createElement("a");
    a.href = url;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // --- main click handler ---------------------------------------------------

  async function onHelpClick() {
    var recipient = getSetting(KEYS.recipient, "");
    if (!recipient) {
      setStatus("Set a recipient in Configure (right-click the extension → Configure…).", true);
      return;
    }

    setStatus("Gathering dashboard details…");
    try {
      var dashboard = tableau.extensions.dashboardContent.dashboard;
      var ctx = {
        dashboardName: dashboard.name,
        workbookName: getSetting(KEYS.workbookName, ""),
        viewUrl: getSetting(KEYS.viewUrl, ""),
        worksheets: dashboard.worksheets.map(function (w) { return w.name; }).join(", "),
        environment: envLabel(),
        timestamp: new Date().toLocaleString(),
        filters: await gatherFilters(dashboard),
        parameters: await gatherParameters(dashboard)
      };

      var subject = "Tableau help request — " + ctx.dashboardName +
        (ctx.workbookName ? " (" + ctx.workbookName + ")" : "");

      var url = buildMailto(recipient, subject, buildBody(ctx, false));
      if (url.length > MAILTO_MAX) {
        // Rebuild without the variable-length filter/parameter detail.
        url = buildMailto(recipient, subject, buildBody(ctx, true));
      }

      openMailto(url);
      setStatus("Opening your email app…");
    } catch (err) {
      console.error("CUSD Request Help failed:", err);
      setStatus("Couldn't prepare the email: " + (err && err.message ? err.message : "unknown error"), true);
    }
  }

  // --- Configure… dialog launch (author-only) -------------------------------
  // Registered via the `configure` callback below; Tableau wires it to the
  // "Configure…" context-menu item declared in the .trex manifest. The parent
  // performs the save so there is exactly one place that writes settings.
  function openConfigure() {
    var payload = JSON.stringify({
      current: {
        recipient: getSetting(KEYS.recipient, ""),
        workbookName: getSetting(KEYS.workbookName, ""),
        viewUrl: getSetting(KEYS.viewUrl, "")
      }
    });
    var url = new URL("./configure.html", window.location.href).href;

    tableau.extensions.ui.displayDialogAsync(url, payload, { height: 420, width: 480 })
      .then(function (closePayload) {
        if (!closePayload || closePayload === "cancel") { return; }
        var cfg = JSON.parse(closePayload);
        var s = tableau.extensions.settings;
        s.set(KEYS.recipient, (cfg.recipient || "").trim());
        s.set(KEYS.workbookName, (cfg.workbookName || "").trim());
        s.set(KEYS.viewUrl, (cfg.viewUrl || "").trim());
        return s.saveAsync();
      })
      .then(function () {
        setStatus("");
      })
      .catch(function (err) {
        // DialogClosedByUser just means the author hit Cancel / closed it.
        if (err && err.errorCode === tableau.ErrorCodes.DialogClosedByUser) { return; }
        console.error("Configure dialog error:", err);
      });
  }

  // --- bootstrap ------------------------------------------------------------
  tableau.extensions.initializeAsync({ configure: openConfigure })
    .then(function () {
      btn.addEventListener("click", onHelpClick);
    })
    .catch(function (err) {
      console.error("Failed to initialize CUSD Request Help:", err);
      setStatus("Could not initialize the extension.", true);
    });
})();
