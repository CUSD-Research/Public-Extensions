/*
 * CUSD Request Help — Configure dialog (author-only)
 * --------------------------------------------------
 * Runs inside the pop-up opened from the extension's "Configure…" menu item.
 * It receives the current settings, lets the author set the recipient inbox and
 * optional workbook label / view URL, and returns the chosen config to the parent
 * (help-request.js), which performs the actual save.
 *
 * This page is pure UI — it never reads or writes settings itself, so there is
 * one and only one place that persists config (the parent).
 */
(function () {
  "use strict";

  var saveBtn = document.getElementById("saveBtn");
  var cancelBtn = document.getElementById("cancelBtn");
  var recipientEl = document.getElementById("recipient");
  var workbookEl = document.getElementById("workbookName");
  var viewUrlEl = document.getElementById("viewUrl");
  var errEl = document.getElementById("cfgError");

  function render(current) {
    recipientEl.value = current.recipient || "";
    workbookEl.value = current.workbookName || "";
    viewUrlEl.value = current.viewUrl || "";
  }

  function onSave() {
    var recipient = (recipientEl.value || "").trim();
    // A recipient is required and must at least look like an address.
    if (!recipient || recipient.indexOf("@") < 1) {
      errEl.textContent = "Enter a valid recipient email address.";
      recipientEl.focus();
      return;
    }
    var cfg = {
      recipient: recipient,
      workbookName: (workbookEl.value || "").trim(),
      viewUrl: (viewUrlEl.value || "").trim()
    };
    tableau.extensions.ui.closeDialog(JSON.stringify(cfg));
  }

  function onCancel() {
    // Sentinel the parent recognises as "leave settings untouched".
    tableau.extensions.ui.closeDialog("cancel");
  }

  tableau.extensions.initializeDialogAsync()
    .then(function (openPayload) {
      var data = {};
      try { data = JSON.parse(openPayload) || {}; } catch (e) { data = {}; }
      render(data.current || {});
      saveBtn.addEventListener("click", onSave);
      cancelBtn.addEventListener("click", onCancel);
    })
    .catch(function (err) {
      console.error("Configure dialog failed to initialize:", err);
      errEl.textContent = "Could not load the configuration dialog.";
    });
})();
