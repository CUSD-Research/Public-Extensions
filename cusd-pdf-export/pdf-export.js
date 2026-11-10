
/*
 * CUSD PDF Export
 * Configuration and worksheet selection.
 *
 * PDF rendering is not yet implemented.
 */

(function () {
  "use strict";

  const btn = document.getElementById("downloadBtn");
  const statusEl = document.getElementById("status");

  let dashboard = null;

  function getSetting(key, fallback) {
    const value = tableau.extensions.settings.get(key);
    return value == null ? fallback : value;
  }

  function getSelectedWorksheets() {
    if (!dashboard) return [];

    const mode = getSetting("exportMode", "selected");

    if (mode === "all") {
      return dashboard.worksheets;
    }

    let allowed = [];

    try {
      allowed = JSON.parse(
        getSetting("allowedSheets", "[]")
      );
    } catch (error) {
      console.error("Invalid worksheet settings", error);
    }

    return dashboard.worksheets.filter(function (sheet) {
      return allowed.includes(sheet.name);
    });
  }

  function refresh() {
    const label = getSetting(
      "buttonLabel",
      "Download to PDF"
    );

    btn.title = label;
    btn.setAttribute("aria-label", label);

    // PDF generation is not implemented yet.
    // Keep the button disabled until it is ready.
    btn.disabled = false;

    const sheets = getSelectedWorksheets();

    if (!sheets.length) {
      statusEl.textContent =
        "Configure worksheets";
    } else {
      statusEl.textContent = "";
    }

    console.log(
      "Configured PDF worksheets:",
      sheets.map(function (sheet) {
        return sheet.name;
      })
    );
  }

  async function configure() {
    const dialogUrl = new URL(
      "./configure.html",
      window.location.href
    ).href;

    try {
      const result =
        await tableau.extensions.ui.displayDialogAsync(
          dialogUrl,
          "",
          { height: 650, width: 550 }
        );

      if (result === "cancel") return;

      const config = JSON.parse(result);

      const settings = tableau.extensions.settings;

      settings.set("exportMode", config.exportMode);
      settings.set(
        "allowedSheets",
        JSON.stringify(config.allowedSheets)
      );
      settings.set(
        "filenamePrefix",
        config.filenamePrefix
      );
      settings.set(
        "buttonLabel",
        config.buttonLabel
      );

      await settings.saveAsync();

      refresh();

    } catch (error) {
      if (
        error.errorCode ===
        tableau.ErrorCodes.DialogClosedByUser
      ) {
        return;
      }

      console.error(error);
      statusEl.textContent =
        "Configuration error";
    }
  }

  async function initialize() {
    try {
      await tableau.extensions.initializeAsync({
        configure: configure
      });

      dashboard =
        tableau.extensions.dashboardContent.dashboard;
console.log("CUSD PDF Export diagnostic", {
  dashboardName: dashboard.name,
  worksheetNames: dashboard.worksheets.map(sheet => sheet.name),
  pageUrl: window.location.href,
  referrer: document.referrer
});
      refresh();

    } catch (error) {
      console.error(error);
      statusEl.textContent =
        "Unable to initialize PDF extension";
    }
  }
btn.addEventListener("click", function () {
  const sheets = getSelectedWorksheets();

  if (sheets.length === 0) {
    alert("Please configure the worksheets first.");
    return;
  }

  alert(
    "PDF export is not implemented yet.\n\n" +
    "Configured worksheets:\n" +
    sheets.map(sheet => sheet.name).join("\n")
  );
});
  initialize();

})();
