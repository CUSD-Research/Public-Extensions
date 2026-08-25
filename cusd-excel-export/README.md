# CUSD Excel Export — Tableau Dashboard Extension

A one-click **Download to Excel** button for Tableau dashboards. The dashboard
author chooses *which worksheet(s) the button may export*; viewers click once and
get an `.xlsx` — **with no "which sheet?" prompt.**

Built and maintained by **Chandler Unified School District — Research & Data
Analytics**.

---

## Why it exists

Tableau's native crosstab download always asks the user to pick a sheet, and the
built-in "Download" object still prompts when a dashboard has more than one
sheet — with no way to pre-set that choice. This extension replaces the prompt
with a single button whose target sheets are fixed by the dashboard author.

## What it does

- **One button → one workbook**, with one tab per allowed worksheet.
- The author selects the allowed sheets in **Configure…**; nothing else can be exported.
- Exports the **summary (aggregated) data shown on screen** — not row-level underlying data.
- **Columns come out in the sheet's on-screen order**, not alphabetical. (Requires a
  Tableau host on Extensions API **1.13+**; older hosts fall back to alphabetical.)
- **Only the columns the author keeps.** A viz carries far more fields than it
  shows — everything on the Tooltip shelf, plus the sort helpers that drive row
  order. Those are ticked off in Configure, and tooltip-only fields and anything
  named `… Sort` start unticked.
- **Readable headers.** The pill caption's aggregation wrapper is stripped, so
  `AVG(Pct At Above)` becomes `Pct At Above` and `ATTR(Common Name)` becomes
  `Common Name`. Date parts (`YEAR(...)`) are left alone — there the wrapper is
  part of what the column means.
- **Numbers stay numbers, percentages stay percentages.** Values are written as
  real numbers carrying an Excel number format rebuilt from Tableau's own
  formatting, so a column of percents can still be sorted and averaged.
- **Nulls are empty cells**, never the word `null`.
- **Optional crosstab layout** — the file can match the shape of the worksheet
  (fields stacked across the top, values in the body) instead of a flat table.
- **Respects row-level security (RLS):** a viewer only ever exports the rows they
  are already permitted to see.
- Optional **"About"** tab — the standard FERPA / data-handling notice, a
  confidentiality note, the source dashboard, and a timestamp.
- **Runs entirely in the browser** — the workbook is built client-side with
  SheetJS; no data is sent to any server.

## How it works

```
Tableau dashboard (in the viewer's browser)
        │   the extension reads the worksheet's *summary* data via the Tableau API
        ▼
  excel-export.js  ──builds the .xlsx in the browser (SheetJS)──►  file downloads to the user's computer
```

The extension is a small static web app (HTML/CSS/JS) that Tableau loads inside
the dashboard. It reads the rendered viz data through the Tableau Extensions API
and writes an Excel file locally. **The host (e.g. GitHub Pages) only serves the
code — no viewer data ever passes through it.**

## Files

| File | Purpose |
|------|---------|
| `cusd-excel-export.trex` | The manifest you add to a dashboard. Its `<url>` points at the hosted `index.html`. |
| `index.html` | The in-dashboard view (the button). |
| `excel-export.js` | Button logic: read allowed sheets → build `.xlsx` → download. |
| `configure.html` / `configure.js` | The author-only **Configure…** dialog (choose sheets + options). |
| `styles.css` | Minimal styling. |
| `../../tests/test_excel_export_extension.js` | Offline regression harness for the header / number-format / layout logic (`node tests/test_excel_export_extension.js`). |
| `icon.svg` / `icon.png` / `make_icon.py` | Icon source (SVG) + rendered PNG + a small script that re-renders the PNG and embeds it in the `.trex`. |
| `lib/` | Tableau Extensions API (vendored). |
| `vendor/` | SheetJS / `xlsx` (vendored). |

Both libraries are included in this repo (vendored), so nothing is fetched from a
CDN at runtime.

## Deploy

The extension is just static files on an **HTTPS** origin, plus a one-time
allow-list entry on your Tableau Cloud site.

1. **Host the files** on any HTTPS origin — GitHub Pages, or an internal web
   server your IT controls. Keep `lib/` and `vendor/` alongside the rest.
2. **Point the manifest** at your host: set `<url>` in `cusd-excel-export.trex`
   to your hosted `index.html`.
3. **Allow-list the host on Tableau Cloud** (site admin, one time):
   *Settings → Extensions →* turn on extensions, then add your host (scheme +
   domain) with **Allow / full data**.
4. **Add it to a dashboard:** drag an **Extension** object in → **Access Local
   Extensions** → choose the `.trex` → **Configure…** the allowed sheets → publish.

> Hosting isn't a one-way door: switching hosts is just re-hosting the same files,
> changing the one `<url>`, and allow-listing the new host. No code changes.

**Tableau Desktop note:** you can test the extension in **Tableau Desktop**
without the Cloud allow-list — Desktop simply prompts you to allow it. The
allow-list is only required for Tableau Cloud / published workbooks.

## Configure options

In the **Configure…** dialog the author sets:

- **Allowed sheets** — only these can be exported.
- **Columns to include** (per sheet) — everything the viz carries is listed;
  untick what shouldn't reach the spreadsheet. Tooltip-only fields and sort
  helpers start unticked.
- **Layout** (per sheet) — *flat table* (one row per mark) or *match the
  worksheet*: pick the field(s) that run across the top and the field that fills
  the cells, and the export comes out as that crosstab, repeated header rows
  merged the way the viz reads.
- **File-name prefix** — the file downloads as `PREFIX_YYYYMMDD.xlsx`.
- **"About" tab** — toggle on/off, plus an editable confidentiality note.
  (The standard FERPA / data-handling notice is always included on the tab.)
- **Button tooltip** — hover text (the button itself is the icon).

### Why the layout is declared rather than detected

The Extensions API exposes the **marks card** (Color, Text, Detail, Tooltip …)
through `getVisualSpecificationAsync`, which is how tooltip-only fields are
spotted. It does **not** expose which fields sit on the **Rows** shelf versus the
**Columns** shelf, and summary data always arrives long/tall. So a crosstab has
to be described once by the author; there is nothing to infer it from.

## Upgrading an existing dashboard

The hosted code is shared, so a change here reaches **every** workbook running
this extension the next time it loads. That upgrade is deliberately split:

| Behaviour | Applies |
|---|---|
| Header cleanup, empty cells for nulls, numeric/percent formatting | Immediately, everywhere — no re-configure |
| Column exclusions, crosstab layout | Only after an author opens **Configure…** on that workbook and saves |

A workbook that is never re-configured keeps exporting every column as a flat
table, exactly as before.

## Privacy & security

- **No data leaves the browser.** Data flows Tableau → the viewer's browser → a
  local file. The host only serves static code.
- **RLS-respecting and allow-listed.** Only the author-approved (aggregate)
  sheets are exportable, and only the rows the viewer can already see.
- **No secrets in this repo** — no credentials, connection strings, or personal
  data; only application code and two open-source libraries.

## Licenses

The bundled libraries keep their own licenses (Tableau Extensions API — MIT;
SheetJS / `xlsx` — Apache-2.0). The CUSD-authored code here is provided as-is;
add a license file if you intend to redistribute it.

## Limitations / ideas

- Summary data only (by design) — no underlying-row export.
- One tab per allowed sheet.
- The crosstab supports **one** value field per sheet; a viz showing two measures
  side by side still needs the flat layout.
- Crosstab row and column order follow the order the summary data arrives in,
  which is the viz's own order — there is no separate sort control.
- File name is `prefix + date`; pulling a field value into the name is a possible enhancement.
- To change the icon, edit `icon.svg` then run `python3 make_icon.py`
  (needs `pip install cairosvg Pillow`).
