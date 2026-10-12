# CUSD KPI Table — Tableau Dashboard Extension

An in-line **KPI table** for Tableau dashboards. Point it at **one ordinary
worksheet** (a dimension + raw measures, flat) and map each column to a mark —
**bar, KPI circle, pie/donut, trend arrow, thumb, sparkline, status pill,
number** — each with its own scale, comparison basis, and color rule.

It replaces the hand-built **`MIN(1)` dual-axis scaffold** technique (dummy
placeholder columns, dual axes, hidden ticks) used to get sparklines / circles /
bars in line with a student or site. Here the row just *lays out* — alignment is
free, and a new KPI column is a couple of dropdowns instead of another axis.

Built and maintained by **Chandler Unified School District — Research & Data
Analytics**.

---

## What it does

- Draws a rich, aligned KPI table **per row** (student, school, teacher, …).
- **One Configure dialog** maps columns → marks; you're only asked for the
  inputs a given mark needs.
- Reads the **summary (aggregated) data shown on screen** — never row-level
  underlying data. **Row-level security is respected** automatically.
- **Follows the dashboard:** re-renders when filters or parameters change.
- Optional **Download to Excel** button (the table's underlying data + a FERPA
  "About" tab).
- **In-product guidance:** an unconfigured table shows the setup steps right on
  the dashboard, and the Configure dialog explains each section inline.

## How it works

```
Tableau dashboard (in the viewer's browser)
  │  the extension reads ONE source worksheet's *summary* data (RLS already applied)
  ▼
renderers.js  ── draws each column's mark from the config ──►  aligned KPI table
```

The extension is a small static web app Tableau loads inside the dashboard.
**The host only serves code — no district data passes through it.**

## The configuration model (the important part)

Open the extension's menu → **Configure…**. Everything is driven off the
dashboard's real field names (no typing), with a **live preview** of your own
sample rows.

**1 · Data source**
- **Source worksheet** — the flat sheet to read (one summary row per entity).
- **Each row is** — the dimension that defines a table row (e.g. *Student*).
- **Row sub-line** *(optional)* — a second line under the row label.
- **Density** — comfortable / compact.
- **Time dimension** *(optional)* — if the sheet has rows per period (e.g. one
  per School Year, on Detail), set it here. Scalar cells then show the **focal
  year**; sparklines trend across years. Toggle a viewer **year selector**, and
  choose whether sparklines **clip** at the focal year or show **all years**
  (highlighting it).
- **Download button** — toggle the Excel export, filename prefix, FERPA tab.

**2 · Columns** — add / reorder / remove. Per column you pick a **mark**, and the
dialog reveals only what that mark needs:

| Mark | Asks you for |
|------|--------------|
| Number / Text / Number+subtotal | value field (text adds a color rule) |
| **Bar → max** | value + **what equals 100%** (a constant *or* a field) + color |
| **Bar vs target** | value + max + **target** (constant or field) |
| Number over bar | value + max + color |
| **KPI circle** | value + color rule |
| **Pie / Donut (% of max)** | value + **max** (e.g. 100, or a denominator field) |
| **Trend arrow** | value + **comparison basis** (▲ above / ▼ below / ► same) |
| **Thumb up/down** | value + comparison basis (or a yes/no flag) |
| Status pill | value + color rule |
| **Sparkline** | a measure; trends it over the time dimension (marker + value at the focal year) |

**The comparison component (color, arrows, thumbs).** This is first-class and
reusable. Coloring/direction is driven by one of:

- **Hard criteria — thresholds.** Value bands → colors (e.g. grade ≥80 green,
  ≥60 amber, else red). Highest matching band wins.
- **A goal value (constant).** e.g. thumb up when *Avg hrs/total ≥ 3.5*.
- **A comparison field.** Compare each row to another field — typically a
  **`FIXED` calc** carried on every row (e.g. the district average), giving the
  classic *"vs district"* arrow. The District row then compares to itself = same.

A **"higher is better"** toggle flips the good/bad sense (so *absences* color
correctly — lower is good). Arrows show raw direction (above/below); thumbs and
comparison-coloring honor higher/lower-is-better.

## Data model

- **One worksheet.** Put the row dimension on **Rows** and every measure + any
  comparison calc (e.g. a `FIXED` district average) on **Detail**. Whatever shows
  in the sheet's **View Data → Summary** tab is exactly what the table reads.
  Format numbers in Tableau; the extension shows your formatted values. Dashboard
  filters flow through automatically.
- **Time / trends (optional).** For a focal-year filter and/or sparklines, also
  put your **time field** (e.g. School Year) on **Detail** so the sheet is one row
  per entity per year. **Leave the year unfiltered** on that sheet — the
  extension's own year selector picks the focal year. Scalar cells show the focal
  year; sparklines trend across years (clip at the focal year, or show all years
  and highlight it — your choice in Configure).
- **Don't use Measure Names / Measure Values** to add the measures — that pivots
  the data long and breaks the one-row-per-entity shape. One pill per measure on
  Detail keeps it wide.
- The worksheet must be **present on the dashboard** (an extension can only read
  worksheets on its own dashboard). Size it small / tuck it away.

## Files

| File | Purpose |
|------|---------|
| `cusd-kpi-table.trex` | Manifest you add to a dashboard. `<url>` → hosted `index.html`. |
| `index.html` | In-dashboard view (toolbar + table container). |
| `renderers.js` | **Shared pure engine** — `(config, rows) → HTML`. Used by the view *and* the dialog preview, so they always match. |
| `kpi-table.js` | Tableau glue: read summary data, render, follow filters/params, export. |
| `configure.html` / `configure.js` | The author-only **Configure…** dialog (progressive disclosure + live preview). |
| `styles.css` | Styling for the view and the dialog. |
| `icon.svg` / `icon.png` / `make_icon.py` | Icon source + rendered PNG + generator. |
| `lib/` | Tableau Extensions API — **vendored at deploy** (not committed). |
| `vendor/` | SheetJS (`xlsx.full.min.js`) for export — **vendored at deploy** (not committed). |
| `mockup.html` | Static look-and-feel prototype (synthetic data; not part of the deployed app). |

> Like `cusd-excel-export`, the `lib/` and `vendor/` libraries are **added at
> hosting time**, not committed, to keep the repo code-only.

## Deploy

1. **Add the libraries** (one-time, into the hosted folder):
   - `lib/tableau.extensions.1.latest.min.js` (Tableau Extensions API)
   - `vendor/xlsx.full.min.js` (SheetJS — only needed for the export button)
2. **Host the folder** on an **HTTPS** origin — GitHub Pages
   (`CUSD-Research/Public-Extensions/cusd-kpi-table/`) with a repo-root
   `.nojekyll`, or internal IIS. `file://` does not work.
3. **Point the manifest** `<url>` at your hosted `index.html`.
4. **Allow-list the host on Tableau Cloud** (site admin, one time):
   *Settings → Extensions →* add the host (scheme + domain) with **Allow / full
   data**. *(Tableau Desktop needs no allow-list — validate there first.)*
5. **Add to a dashboard:** place the source worksheet(s) on the dashboard → drag
   an **Extension** object → **Access Local Extensions** → pick the `.trex` →
   **Configure…**.
6. **Updating code:** push → Pages redeploys → Tableau pulls the new code on next
   load (hard-refresh to bust cache; no need to re-add or re-publish).

## Subscriptions caveat

Extensions render **only in a live browser**. Tableau's **server-side
image/PDF exports and email subscriptions do not render extensions** — the
extension area comes through blank. Use this on **interactively-viewed**
dashboards; for subscription-delivered ones, keep a native (scaffolded) sheet as
the emailed fallback.

## Privacy & security

- **Summary data only** — no underlying-row reads. Aggregate-fine /
  per-student-rosters-never still applies to what you put on the source sheet.
- **RLS-respecting** — a viewer only sees (and exports) rows they're authorized to.
- **No data leaves the browser** — the host serves static code; the export is
  built client-side.
- **No secrets / no PII in this repo** — application code only; libraries are
  vendored at deploy.

## Limitations / ideas

- Server-side subscriptions don't render extensions (above).
- Large tables: fine for hundreds of rows; very large sets would want
  virtualization.
- Click-to-filter / tooltips are not wired yet (possible enhancement via the
  Extensions API).
- To change the icon: edit `icon.svg`, then `python3 make_icon.py`
  (`pip install cairosvg Pillow`).
