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
- **Rows in the order the sheet is sorted.** A field can be a *sort key* without
  being in the file, so the hidden `Location Sort` / `Grade Sort` columns behind a
  CUSD viz order the spreadsheet and never appear in it.
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
3. **Allow-list this extension on Tableau Cloud** (site admin, once per
   extension — the list is keyed by URL, not by domain, so other extensions on
   the same host are not covered): *Settings → Extensions → Dashboard
   Extensions →* turn on extensions, then **Add URL** with the `.trex`'s exact
   `<url>` and **Allow Full Data Access = Yes** (this extension declares `full
   data`). See the [repo README](../README.md#every-new-extension-needs-its-own-tableau-cloud-allow-list-entry).
4. **Add it to a dashboard:** drag an **Extension** object in → **Access Local
   Extensions** → choose the `.trex` → **Configure…** the allowed sheets → publish.

> Hosting isn't a one-way door: switching hosts is just re-hosting the same files,
> changing the one `<url>`, and allow-listing the new URL. No code changes.

**Tableau Desktop note:** you can test the extension in **Tableau Desktop**
without the Cloud allow-list — Desktop simply prompts you to allow it. The
allow-list is only required for Tableau Cloud / published workbooks.

## Configure options

In the **Configure…** dialog the author sets:

- **Allowed sheets** — only these can be exported.
Then, **per sheet**, three numbered steps:

1. **What goes in the file** — every field the viz carries is listed; untick what
   shouldn't reach the spreadsheet. Tooltip-only fields and sort helpers start
   unticked for you.
2. **What order the rows come out in** — tick the field(s) the sheet is sorted
   by, in priority order, each ascending or descending. **A sort key does not
   have to be in the file** — that is the point of it.
3. **How the file is laid out** — a plain table (one row per mark), or a crosstab
   like the worksheet: name the field(s) that run across the top and the field
   that fills the cells. **The order you tick the across-the-top fields decides
   how the table groups** — `Benchmark Period` then `School Year` gives one `BOY`
   heading spanning its years; the other way round groups by year instead.
- **File-name prefix** — the file downloads as `PREFIX_YYYYMMDD.xlsx`.
- **"About" tab** — toggle on/off, plus an editable confidentiality note.
  (The standard FERPA / data-handling notice is always included on the tab.)
- **Button tooltip** — hover text (the button itself is the icon).

### Worked example — a school × grade × year crosstab

For a sheet with `School` and `Grade` on Rows, `Benchmark Period` and
`School Year` on Columns, `Pct At Above` on Text, and a stack of tooltip fields:

| Step | What to pick |
|---|---|
| 1. What goes in the file | `School`, `Grade`, `Benchmark Period`, `School Year`, `Pct At Above`. Leave the tooltip fields and `Location Sort` / `Grade Sort` unticked. |
| 2. What order | `Location Sort`, then `Grade Sort` — both unticked in step 1, both still obeyed. |
| 3. Layout | *Like the worksheet*; across the top `Benchmark Period` **then** `School Year`; cells `Pct At Above`. |

Result: `DISTRICT` first then schools in the viz's own order, `ALL GRADES` above
`KG` above `GRADE 1`, one merged `BOY` heading spanning 2025/2026/2027 followed
by `MOY` over its own years, and percentages Excel can average.

Tick `School Year` first instead and the same data comes out grouped by year,
with each year spanning `BOY`/`MOY`/`EOY`. Neither is more correct — the stack
order is the choice.

### Why layout and sort are declared rather than detected

Two different holes in the API, with the same consequence:

- **Layout.** `getVisualSpecificationAsync` exposes the **marks card** (Color,
  Text, Detail, Tooltip …), which is how tooltip-only fields are spotted. It does
  **not** expose which fields sit on the **Rows** shelf versus the **Columns**
  shelf, and summary data always arrives long/tall.
- **Sort.** There is no sort accessor on `Worksheet` at all — the API has a
  `SortDirection` enum and nothing that reads or reports a sheet's sort. So the
  export cannot copy the viz's row order.

What it *can* do is obey the same field the viz obeys. A CUSD viz table ships
explicit sort columns (`locationSort`, `gradeSort`, `benchmarkPeriodSort`), and a
sheet sorted by one has that field in its data — so naming it as a sort key
reproduces the order exactly. **"Don't export this column" and "don't use this
column" are separate instructions**, which is why the column picker and the sort
picker are separate lists over the same fields.

In a crosstab, a sort key orders whichever axis it is *constant* along: a grade
sort varies down the rows and reads the same across, so it orders rows; a period
sort that varies across the top orders columns. A key constant along neither
disagrees with itself inside one cell and is ignored rather than guessed at.

**Below the sort keys, each axis is ordered by its own stacked fields, outermost
first** — that is what makes the crosstab *group* the way the worksheet groups
rather than merely carry the same header rows. The ordering value inside a level
is each value's first appearance in the data, not the value itself: the data
already arrives `BOY`, `MOY`, `EOY`, and alphabetising it would read `BOY`, `EOY`,
`MOY`.

## Upgrading an existing dashboard

The hosted code is shared, so a change here reaches **every** workbook running
this extension the next time it loads. That upgrade is deliberately split:

| Behaviour | Applies |
|---|---|
| Header cleanup, empty cells for nulls, numeric/percent formatting | Immediately, everywhere — no re-configure |
| Column exclusions, row order, crosstab layout | Only after an author opens **Configure…** on that workbook and saves |

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
- With no sort key picked, rows come out in whatever order the summary data
  arrives in. That is usually the viz's order, but it is not guaranteed — pick a
  sort key if the order matters.
- Duplicate header names (a field on Rows *and* the same field as `ATTR()` on
  Tooltip both clean to `Grade`) are numbered — `Grade`, `Grade (2)`. Usually the
  duplicate is the tooltip copy and is excluded anyway.
- File name is `prefix + date`; pulling a field value into the name is a possible enhancement.
- To change the icon, edit `icon.svg` then run `python3 make_icon.py`
  (needs `pip install cairosvg Pillow`).
