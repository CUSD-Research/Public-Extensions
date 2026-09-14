/*
 * CUSD PDF Print — Configure dialog (author-only)
 * ----------------------------------------------
 * Pure UI. It receives the current settings from the parent (pdf-print.js),
 * validates what the author types, and hands the config back for the parent to
 * save — so there is exactly one place that persists settings.
 */
(function () {
  "use strict";

  var L = window.CusdPdfPrint;

  var els = {
    save: document.getElementById("saveBtn"),
    cancel: document.getElementById("cancelBtn"),
    viewUrl: document.getElementById("viewUrl"),
    urlWarn: document.getElementById("urlWarn"),
    paper: document.getElementById("paper"),
    marginIn: document.getElementById("marginIn"),
    settleMs: document.getElementById("settleMs"),
    autoPrint: document.getElementById("autoPrint"),
    carryFilters: document.getElementById("carryFilters"),
    err: document.getElementById("cfgError")
  };

  var hostHint = "";

  function render(data) {
    var current = data.current || {};
    var defaults = L.DEFAULTS;   // one copy, read from the shipped module
    hostHint = data.hostHint || "";

    var html = "";
    for (var id in L.PAPERS) {
      if (!Object.prototype.hasOwnProperty.call(L.PAPERS, id)) { continue; }
      html += '<option value="' + id + '">' + L.PAPERS[id].label + "</option>";
    }
    els.paper.innerHTML = html;

    els.viewUrl.value = current.viewUrl || "";
    els.paper.value = L.PAPERS[current.paper] ? current.paper : defaults.paper;
    els.marginIn.value = (current.marginIn !== undefined) ? current.marginIn : defaults.marginIn;
    els.settleMs.value = (current.settleMs !== undefined) ? current.settleMs : defaults.settleMs;
    els.autoPrint.checked = (current.autoPrint !== undefined) ? !!current.autoPrint : !!defaults.autoPrint;
    els.carryFilters.checked = (current.carryFilters !== undefined) ? !!current.carryFilters : !!defaults.carryFilters;

    checkUrlHost();
  }

  /*
   * A URL pasted from a different Tableau site loads a DIFFERENT dashboard, and
   * the print window has no way to notice. So compare its host against the host
   * actually serving this dashboard and warn here, where the author can still
   * fix it.
   */
  function checkUrlHost() {
    els.urlWarn.textContent = "";
    if (!hostHint) { return; }
    var typed = L.hostOf(els.viewUrl.value);
    if (!typed) { return; }
    var serving = L.hostOf(hostHint);
    if (serving && typed !== serving) {
      els.urlWarn.textContent =
        "Heads up: this dashboard is being served from " + serving +
        " but the URL points at " + typed + ".";
    }
  }

  function onSave() {
    els.err.textContent = "";

    // Blank is allowed and is the normal state for a dashboard that has not been
    // published yet: there is no URL to paste until it exists. The first click of
    // the PDF button captures it. Only a URL that is present and WRONG blocks.
    var check = L.normalizeViewUrl(els.viewUrl.value);
    if (!check.ok && !check.missing) {
      els.err.textContent = check.problem;
      els.viewUrl.focus();
      return;
    }

    var marginIn = parseFloat(els.marginIn.value);
    if (!isFinite(marginIn) || marginIn < 0 || marginIn > 2) {
      els.err.textContent = "Page margin must be between 0 and 2 inches.";
      els.marginIn.focus();
      return;
    }

    var settleMs = parseInt(els.settleMs.value, 10);
    if (!isFinite(settleMs) || settleMs < 0 || settleMs > 60000) {
      els.err.textContent = "Render wait must be between 0 and 60000 milliseconds.";
      els.settleMs.focus();
      return;
    }

    tableau.extensions.ui.closeDialog(JSON.stringify({
      viewUrl: check.ok ? check.url : "",
      paper: els.paper.value,
      marginIn: marginIn,
      settleMs: settleMs,
      autoPrint: els.autoPrint.checked,
      carryFilters: els.carryFilters.checked
    }));
  }

  function onCancel() {
    // Sentinel the parent recognises as "leave settings untouched".
    tableau.extensions.ui.closeDialog("cancel");
  }

  tableau.extensions.initializeDialogAsync()
    .then(function (openPayload) {
      var data = {};
      try { data = JSON.parse(openPayload) || {}; } catch (e) { data = {}; }
      render(data);
      els.viewUrl.addEventListener("input", checkUrlHost);
      els.save.addEventListener("click", onSave);
      els.cancel.addEventListener("click", onCancel);
    })
    .catch(function (err) {
      console.error("Configure dialog failed to initialize:", err);
      els.err.textContent = "Could not load the configuration dialog.";
    });
})();
