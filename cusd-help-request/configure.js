/*
 * CUSD Request Help — Configure dialog (author-only)
 * --------------------------------------------------
 * Pure UI. Receives the current settings + the built-in default recipient, lets
 * the author optionally override the inbox or add a view URL, and returns the
 * config to the parent (help-request.js), which performs the save. It never reads
 * or writes settings itself, so there is exactly one place that persists config.
 */
(function () {
  "use strict";

  var saveBtn = document.getElementById("saveBtn");
  var cancelBtn = document.getElementById("cancelBtn");
  var recipientEl = document.getElementById("recipient");
  var viewUrlEl = document.getElementById("viewUrl");
  var hintEl = document.getElementById("recipientHint");
  var errEl = document.getElementById("cfgError");

  function render(data) {
    var current = data.current || {};
    recipientEl.value = current.recipient || "";
    viewUrlEl.value = current.viewUrl || "";
    if (data.defaultRecipient) {
      recipientEl.placeholder = data.defaultRecipient;
      hintEl.textContent = "Leave blank to use the default (" + data.defaultRecipient + ").";
    }
  }

  function onSave() {
    var recipient = (recipientEl.value || "").trim();
    // Recipient is optional (blank = use the built-in default); only validate a
    // value if one was entered.
    if (recipient && recipient.indexOf("@") < 1) {
      errEl.textContent = "That doesn't look like a valid email address.";
      recipientEl.focus();
      return;
    }
    var cfg = {
      recipient: recipient,
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
      render(data);
      saveBtn.addEventListener("click", onSave);
      cancelBtn.addEventListener("click", onCancel);
    })
    .catch(function (err) {
      console.error("Configure dialog failed to initialize:", err);
      errEl.textContent = "Could not load the configuration dialog.";
    });
})();
