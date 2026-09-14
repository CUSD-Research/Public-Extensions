# CUSD Public Extensions

Static hosting for Chandler Unified School District's Tableau dashboard extensions.
GitHub Pages serves this repo's `main` branch at `https://cusd-research.github.io/Public-Extensions/`,
one folder per extension, each carrying its own `lib/` copy of the Tableau Extensions API.
`.nojekyll` at the root keeps Pages from dropping `lib/`.

| Folder | Extension | Hosted URL |
|---|---|---|
| `cusd-excel-export/` | CUSD Excel Export | `https://cusd-research.github.io/Public-Extensions/cusd-excel-export/index.html` |
| `cusd-feeder-flow/` | CUSD Feeder Flow | `https://cusd-research.github.io/Public-Extensions/cusd-feeder-flow/index.html` |
| `cusd-help-request/` | CUSD Help Request | `https://cusd-research.github.io/Public-Extensions/cusd-help-request/index.html` |
| `cusd-kpi-table/` | CUSD KPI Table | `https://cusd-research.github.io/Public-Extensions/cusd-kpi-table/index.html` |

Each folder's `README.md` covers that extension: what it does, the worksheet it
reads, its Configure options, and how to host an update.

## Every new extension needs its own Tableau Cloud allow-list entry

**This is not a one-time setup for the host — it is a step for every extension you add.**
The Tableau Cloud allow list is keyed by the extension's **URL**, not by its domain, so
allow-listing `cusd-excel-export` does nothing for `cusd-feeder-flow`. Confirmed on the
CUSD site 2026-09-12: a newly hosted extension did not run until its own URL was added.

Do this once per extension, as a **Site Administrator**, after the folder is live on Pages:

1. Tableau Cloud → **Settings** → **Extensions** tab.
2. In **Dashboard Extensions** (not *Viz Extensions* — everything here is a dashboard
   extension), confirm **"Let users run extensions on this site"** is on.
3. Under **Enable Specific Extensions** → **Add URL**, paste the extension's URL
   **exactly as it appears in the `<url>` of its `.trex`** — full path, including
   `/index.html`. The table above has all four.
4. Set **Allow Full Data Access = Yes**. Every extension in this repo declares
   `<permission>full data</permission>` in its manifest, and Tableau Cloud **blocks** a
   full-data extension that has not been explicitly granted it — the dashboard shows an
   error rather than the extension.
5. Set the user prompt to **No** unless you want every viewer asked to allow data access
   on first load.
6. **Save**, then hard-refresh the published dashboard.

Notes:

- **Tableau Desktop needs none of this.** Desktop prompts you locally to allow the
  extension, which is why each README says to validate in Desktop first. A missing
  allow-list entry only shows up after publishing to Cloud.
- **Allow-list before you blame the code.** If the extension area is blank or errors on
  Cloud but works in Desktop, check the allow list before anything else.
- **Check Pages first.** Open the hosted URL in a plain browser tab. The pass is the
  Tableau library's own sentence *"…is not running inside an iframe, desktop, or popup
  window."* A 404 means the folder never deployed, and no allow-list entry will help.
- **Updating an extension's code needs no allow-list change** — the URL does not move.
  Only a brand-new extension, or a changed `<url>`, needs a new entry.

## Adding an extension to this repo

1. Push the extension's folder (code plus its own `lib/tableau.extensions.1.latest.min.js`)
   on a branch, and merge it to `main`.
2. Wait for Pages to deploy, then open the hosted URL and check for the sentence above.
3. Add the new URL to the Cloud allow list, per the section above.
4. Add a row to the table at the top of this file.
