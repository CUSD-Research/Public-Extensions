# CUSD Excel Export — Tableau Dashboard Extension

A one-click **Download to Excel** button for Tableau dashboards. The dashboard
author chooses *which worksheet(s) the button is allowed to export*; end users
click once and get an `.xlsx` — **no "which sheet?" selection dialog.**

This solves the recurring pain that Tableau's native crosstab download always
prompts the user to pick a sheet, and the native "Download" dashboard object
still prompts when a dashboard has more than one sheet. There is no way to
pre-seed that native dialog — so instead this extension *replaces* it with a
button whose target sheets are fixed by the author.

> **Status:** First cut. The code is complete, but it has **not yet been
> run against a live Tableau Cloud dashboard** — that test needs Kent (it
> requires the site allow-list step below). Treat as a reviewable draft.

---

## How it works

1. Sits in a dashboard zone as an Extension object showing one button.
2. On click it reads the **summary data** (the aggregated data already shown
   on screen) of each allowed worksheet via `getSummaryDataReaderAsync()`.
   Because it reads the rendered viz, **RLS is respected automatically** — a
   user only ever exports rows they are already allowed to see.
3. It builds the workbook **in the browser** (SheetJS) and triggers the
   download. No district data is sent anywhere.

## CUSD guardrails (why this isn't a generic export button)

- **Allow-list only.** The button exports *only* the worksheets the author
  ticked in `Configure…`. A hidden or underlying sheet that was never enabled
  cannot be dumped — important for the *aggregate-counts-fine /
  per-student-rosters-never* rule.
- **Summary data only.** It reads the displayed (aggregated) data, never the
  row-level underlying data. (Underlying-row export is intentionally not wired
  up.)
- **Confidentiality tab + CUSD file name.** Optional "About this export" tab
  with a confidentiality note + provenance; file name defaults to
  `CUSD_Export_YYYYMMDD.xlsx` (prefix is configurable).

---

## Files

| File | Purpose |
|------|---------|
| `cusd-excel-export.trex` | The manifest you add to a dashboard. **Edit the `<url>`** to your host. |
| `index.html` | In-dashboard view (the button). |
| `excel-export.js` | Button logic: read allowed sheets → build `.xlsx` → download. |
| `configure.html` / `configure.js` | The author-only "Configure…" dialog (pick allowed sheets + options). |
| `styles.css` | Minimal styling. |
| `icon.svg` / `icon.png` / `make_icon.py` | Icon master (SVG) + rendered PNG + the script that rasterises the SVG and embeds the Base64 into the `.trex`. Edit `icon.svg`, then `python3 make_icon.py` (needs `pip install cairosvg Pillow`). |
| `lib/`, `vendor/` | Where the two libraries go (see next section). Not committed. |

## One-time: add the two libraries

To keep everything self-hosted (no CDN calls at runtime, nothing fetched from
the public internet while a user is working), drop two minified libraries into
the folder before deploying:

```bash
mkdir -p lib vendor

# 1. Tableau Extensions API (v1.10+ — needed for getSummaryDataReaderAsync)
curl -L -o lib/tableau.extensions.1.latest.min.js \
  https://tableau.github.io/extensions-api/lib/tableau.extensions.1.latest.min.js

# 2. SheetJS (xlsx) community build
curl -L -o vendor/xlsx.full.min.js \
  https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
```

*(For a quick smoke test only, you can instead point the two `<script>` tags in
`index.html`/`configure.html` at those CDN URLs directly. For production, vendor
them as above so nothing loads from an external host at run time.)*

---

## Deploy

The extension is just static files on an **HTTPS** origin, plus a one-time
allow-list entry on the Tableau Cloud site.

### Option A — GitHub Pages (recommended to start)

Fast, free, HTTPS out of the box. **Only the app code is served publicly — no
student data ever transits GitHub** (data goes Tableau → browser → local file).

1. Create a **separate, dedicated public repo** — e.g. `cusd-tableau-excel-export`.
   Keep it code-only; do **not** host this from the private data-vault repo.
2. Copy the contents of this folder (including the `lib/` and `vendor/` files
   you downloaded above) to the repo root.
3. **Settings → Pages →** Source: `Deploy from a branch`, Branch: `main`, folder
   `/ (root)`. Save.
4. Your URL will be `https://YOUR-GH-ORG.github.io/cusd-tableau-excel-export/index.html`.
5. Put that URL in `cusd-excel-export.trex` → `<source-location><url>`.

*If district policy forbids external hosting, use Option B — the files are
identical; only the `.trex` URL and the allow-list entry change, so starting on
Pages does not lock you in.*

### Option B — Internal HTTPS server (IIS on the Research box)

1. Publish this folder (with `lib/` + `vendor/`) to an HTTPS site IT controls,
   e.g. `https://research.cusd80.com/tableau-ext/excel-export/`.
2. Point the `.trex` `<url>` at `…/index.html` on that host.

### Required for either option — allow-list the host on Tableau Cloud (admin)

A **site admin** must do this once, or Tableau will block the extension:

1. Tableau Cloud → **Settings → Extensions**.
2. Ensure *Let users run extensions on this site* is on.
3. Under **Allow / deny specific extensions**, add the host URL (scheme +
   domain, e.g. `https://YOUR-GH-ORG.github.io`) to the allow list, and set it
   to **Allow full data** (the export needs to read the worksheet's data).

## Add it to a dashboard

1. In Tableau Desktop/Web Edit, drag an **Extension** object onto the dashboard.
2. Choose **Access Local Extensions** → select `cusd-excel-export.trex`.
   (First use of a new host will prompt you to allow it / its data access.)
3. Open the extension's drop-down (the small caret) → **Configure…** → tick the
   worksheet(s) the button may export, set the file-name prefix / button label /
   confidentiality note → **Save**.
4. Publish. Done — end users just press the button.

---

## Privacy / PII

The resulting `.xlsx` is still student data sitting on someone's disk — exactly
like any native Tableau crosstab download, so this adds no *new* exposure. What
it adds is *control*: the author fixes which (aggregate) sheets are exportable,
and the file never round-trips through an external server.

## Portability

Hosting choice is not a one-way door. Moving from GitHub Pages to internal IIS
(or vice versa) = re-host the same files, change one `<url>` in the `.trex`, and
re-allow-list the new host. No code changes.

## Limitations / possible follow-ups

- Summary data only (by design). No underlying-row export.
- One workbook with one tab per allowed sheet; no per-sheet column picker yet
  (the open-source "Export All" extension has one if we ever want that depth).
- Icon is rendered from `icon.svg` (the master). Edit the SVG + re-run
  `make_icon.py` to change it.
- File name uses a static prefix + date; pulling a field value (e.g. school +
  `schoolYear`) into the name is a possible enhancement.
