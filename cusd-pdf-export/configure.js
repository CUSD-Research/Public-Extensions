
/*
 * CUSD PDF Export — Configuration
 * Loads dashboard worksheets and saves export preferences.
 */

(function () {
  "use strict";

  const allRadio = document.getElementById("allSheets");
  const selectedRadio = document.getElementById("selectedSheets");
  const selection = document.getElementById("sheetSelection");
  const sheetList = document.getElementById("sheetList");
  const prefix = document.getElementById("prefix");
  const buttonLabel = document.getElementById("buttonLabel");
  const saveBtn = document.getElementById("saveBtn");
  const cancelBtn = document.getElementById("cancelBtn");

  let worksheetNames = [];

  function updateSelection() {
    selection.style.display =
      selectedRadio.checked ? "block" : "none";
  }

  allRadio.addEventListener("change", updateSelection);
  selectedRadio.addEventListener("change", updateSelection);

  function loadSettings() {
    const settings = tableau.extensions.settings;

    const mode = settings.get("exportMode") || "selected";
    const savedSheets = JSON.parse(
      settings.get("allowedSheets") || "[]"
    );

    allRadio.checked = mode === "all";
    selectedRadio.checked = mode !== "all";

    prefix.value =
      settings.get("filenamePrefix") || "CUSD_Export";

    buttonLabel.value =
      settings.get("buttonLabel") || "Download to PDF";

    sheetList.innerHTML = "";

    worksheetNames.forEach(function (name) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");

      checkbox.type = "checkbox";
      checkbox.value = name;
      checkbox.checked = savedSheets.includes(name);

      label.appendChild(checkbox);
      label.appendChild(
        document.createTextNode(" " + name)
      );

      sheetList.appendChild(label);
    });

    updateSelection();
  }

  async function initialize() {
    try {
      await tableau.extensions.initializeDialogAsync();

      const dashboard =
        tableau.extensions.dashboardContent.dashboard;

      worksheetNames = dashboard.worksheets.map(
        function (worksheet) {
          return worksheet.name;
        }
      );

      loadSettings();

    } catch (error) {
      sheetList.textContent =
        "Unable to load worksheets: " + error.message;
      saveBtn.disabled = true;
    }
  }

  saveBtn.addEventListener("click", function () {
    const mode = allRadio.checked ? "all" : "selected";

    const checked = Array.from(
      sheetList.querySelectorAll(
        'input[type="checkbox"]:checked'
      )
    ).map(function (checkbox) {
      return checkbox.value;
    });

    if (mode === "selected" && checked.length === 0) {
      alert("Please select at least one worksheet.");
      return;
    }

    const settings = tableau.extensions.settings;

    settings.set("exportMode", mode);
    settings.set("allowedSheets", JSON.stringify(checked));
    settings.set(
      "filenamePrefix",
      prefix.value.trim() || "CUSD_Export"
    );
    settings.set(
      "buttonLabel",
      buttonLabel.value.trim() || "Download to PDF"
    );

    // Return choices to the parent extension.
    // The parent will persist them with settings.saveAsync().
    tableau.extensions.ui.closeDialog(
      JSON.stringify({
        exportMode: mode,
        allowedSheets: checked,
        filenamePrefix: prefix.value.trim() || "CUSD_Export",
        buttonLabel: buttonLabel.value.trim() || "Download to PDF"
      })
    );
  });

  cancelBtn.addEventListener("click", function () {
    tableau.extensions.ui.closeDialog("cancel");
  });

  initialize();

})();
